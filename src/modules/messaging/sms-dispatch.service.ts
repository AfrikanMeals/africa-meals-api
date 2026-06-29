import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsEngineEnum } from '@schemas/maintenance-alert-settings.schema';
import {
  phoneToBirdE164,
  readBirdSmsConfig,
  sendBirdSmsMessage,
} from '@modules/ads/bird-channels.util';
import { PlatformChannelsService } from '@modules/platform-channels/platform-channels.service';
import {
  readTwilioSmsConfig,
  sendTwilioSmsMessage,
} from './twilio-sms.util';

export type SmsDispatchResult = {
  ok: boolean;
  engine: SmsEngineEnum | null;
  messageId?: string | null;
  error?: string;
};

/** Envoi SMS plateforme (Ads, vendeur, alertes) sans dépendance lourde sur DbMaintenance. */
@Injectable()
export class SmsDispatchService {
  private readonly logger = new Logger(SmsDispatchService.name);
  private engineCache: { value: SmsEngineEnum; expiresAt: number } | null = null;

  constructor(
    private readonly platformChannels: PlatformChannelsService,
    private readonly config: ConfigService,
  ) {}

  clearEngineCache(): void {
    this.engineCache = null;
  }

  async sendSms(args: {
    toPhone: string;
    body: string;
    defaultCountryCode?: string;
  }): Promise<SmsDispatchResult> {
    const configuredEngine = await this.getSmsEngine();
    const env = await this.platformChannels.getSmsMergedEnv();
    const engine = this.resolveEngineForSend(configuredEngine, env);
    const defaultCc =
      args.defaultCountryCode?.trim() ||
      this.config.get<string>('AD_NOTIFICATION_SMS_DEFAULT_COUNTRY_CODE')?.trim() ||
      this.config.get<string>('AD_NOTIFICATION_WHATSAPP_DEFAULT_COUNTRY_CODE')?.trim() ||
      '1';
    const to = phoneToBirdE164(args.toPhone, defaultCc);
    if (!to) {
      return { ok: false, engine, error: 'invalid_phone' };
    }

    if (engine === SmsEngineEnum.AUTO) {
      return { ok: false, engine, error: 'no_sms_engine_configured' };
    }

    if (engine === SmsEngineEnum.TWILIO) {
      const twilio = readTwilioSmsConfig(env);
      if (!twilio) {
        return { ok: false, engine, error: 'twilio_not_configured' };
      }
      try {
        const res = await sendTwilioSmsMessage({
          config: twilio,
          to,
          body: args.body,
        });
        return { ok: true, engine, messageId: res.messageId };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Twilio SMS failed: ${msg}`);
        return { ok: false, engine, error: msg };
      }
    }

    const bird = readBirdSmsConfig(env);
    if (!bird) {
      return { ok: false, engine, error: 'bird_sms_not_configured' };
    }
    try {
      const res = await sendBirdSmsMessage({ config: bird, to, body: args.body });
      return { ok: true, engine, messageId: res.messageId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Bird SMS failed: ${msg}`);
      return { ok: false, engine, error: msg };
    }
  }

  private async getSmsEngine(): Promise<SmsEngineEnum> {
    const now = Date.now();
    if (this.engineCache && this.engineCache.expiresAt > now) {
      return this.engineCache.value;
    }
    const value = await this.platformChannels.getSmsEngineSetting();
    this.engineCache = { value, expiresAt: now + 30_000 };
    return value;
  }

  private resolveEngineForSend(
    configured: SmsEngineEnum,
    env: NodeJS.ProcessEnv,
  ): SmsEngineEnum {
    if (configured !== SmsEngineEnum.AUTO) {
      return configured;
    }
    const available: SmsEngineEnum[] = [];
    if (readBirdSmsConfig(env)) {
      available.push(SmsEngineEnum.BIRD);
    }
    if (readTwilioSmsConfig(env)) {
      available.push(SmsEngineEnum.TWILIO);
    }
    if (available.length === 0) {
      return SmsEngineEnum.AUTO;
    }
    if (available.length === 1) {
      return available[0]!;
    }
    return available[Math.floor(Math.random() * available.length)]!;
  }
}
