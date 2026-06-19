import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  MaintenanceAlertSettingsDocument,
  MaintenanceAlertSettingsModel,
  SmsEngineEnum,
} from '@schemas/maintenance-alert-settings.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { DbMaintenanceService } from '@modules/db-maintenance/db-maintenance.service';
import { isTelegramBotConfigured } from '@modules/messaging/telegram-bot.util';
import { UpdateMaintenanceAlertSettingsDto } from './dto/update-maintenance-alert-settings.dto';

const SETTINGS_KEY = 'default';
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export type MaintenanceAlertSettingsResponse = {
  alertsEnabled: boolean;
  emailRecipients: string[];
  whatsappEnabled: boolean;
  telegramEnabled: boolean;
  smsNotifierEnabled: boolean;
  alertPhones: string[];
  telegramChatIds: string[];
  cooldownMinutes: number;
  smsEngine: SmsEngineEnum;
  updatedAt: string | null;
  channelAvailability: {
    email: boolean;
    whatsapp: boolean;
    telegram: boolean;
    sms: boolean;
    birdSms: boolean;
    twilioSms: boolean;
  };
};

@Injectable()
export class MaintenanceAlertSettingsService {
  private readonly logger = new Logger(MaintenanceAlertSettingsService.name);

  constructor(
    @InjectModel(MaintenanceAlertSettingsModel.name)
    private readonly settingsModel: Model<MaintenanceAlertSettingsModel>,
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly config: ConfigService,
  ) {}

  async getSettings(user: UserModel): Promise<MaintenanceAlertSettingsResponse> {
    await this.dbMaintenance.assertAdminSettingsPermission(user);
    const doc = await this.ensureSettings();
    return this.toResponse(doc);
  }

  async getSettingsInternal(): Promise<MaintenanceAlertSettingsDocument> {
    return this.ensureSettings();
  }

  async updateSettings(
    user: UserModel,
    dto: UpdateMaintenanceAlertSettingsDto,
  ): Promise<MaintenanceAlertSettingsResponse> {
    await this.dbMaintenance.assertAdminSettingsPermission(user);

    const patch: Record<string, unknown> = {};
    if (dto.alertsEnabled !== undefined) patch.alertsEnabled = dto.alertsEnabled;
    if (dto.emailRecipients !== undefined) {
      patch.emailRecipients = normalizeEmails(dto.emailRecipients);
    }
    if (dto.whatsappEnabled !== undefined) {
      patch.whatsappEnabled = dto.whatsappEnabled;
    }
    if (dto.telegramEnabled !== undefined) {
      patch.telegramEnabled = dto.telegramEnabled;
    }
    if (dto.smsNotifierEnabled !== undefined) {
      patch.smsNotifierEnabled = dto.smsNotifierEnabled;
    }
    if (dto.alertPhones !== undefined) {
      patch.alertPhones = normalizePhones(dto.alertPhones);
    }
    if (dto.telegramChatIds !== undefined) {
      patch.telegramChatIds = normalizeTelegramIds(dto.telegramChatIds);
    }
    if (dto.cooldownMinutes !== undefined) {
      patch.cooldownMinutes = dto.cooldownMinutes;
    }
    if (dto.smsEngine !== undefined) {
      patch.smsEngine = dto.smsEngine;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('no_fields_to_update');
    }

    const updated = await this.settingsModel
      .findOneAndUpdate({ key: SETTINGS_KEY }, { $set: patch }, { new: true })
      .exec();
    if (!updated) {
      throw new BadRequestException('settings_update_failed');
    }
    this.logger.log(`Maintenance alert settings updated by user=${user.id}`);
    return this.toResponse(updated);
  }

  async updateAlertState(
    serviceKey: string,
    entry: { status: string; alertedAt?: Date | null; recoveredAt?: Date | null },
  ): Promise<void> {
    await this.settingsModel
      .updateOne(
        { key: SETTINGS_KEY },
        {
          $set: {
            [`lastAlertStates.${serviceKey}`]: entry,
          },
        },
      )
      .exec();
  }

  getChannelAvailability(): MaintenanceAlertSettingsResponse['channelAvailability'] {
    const env = process.env;
    const birdAccess =
      Boolean(env.BIRD_ACCESS_KEY?.trim()) &&
      Boolean(env.BIRD_WORKSPACE_ID?.trim());
    const birdSms = birdAccess && Boolean(
      env.BIRD_SMS_CHANNEL_ID?.trim() || env.BIRD_SMS_CHANNEL?.trim(),
    );
    const birdWhatsApp = birdAccess && Boolean(
      env.BIRD_WHATSAPP_CHANNEL_ID?.trim() ||
        env.BIRD_WHATSAPP_CHANNEL?.trim(),
    );
    const telegramBot = isTelegramBotConfigured(env);
    const twilioSms = Boolean(
      env.TWILIO_ACCOUNT_SID?.trim() &&
        env.TWILIO_AUTH_TOKEN?.trim() &&
        (env.TWILIO_SMS_FROM?.trim() || env.TWILIO_PHONE_NUMBER?.trim()),
    );
    const maintenanceWhatsApp =
      env.MAINTENANCE_WHATSAPP_ENABLED === 'true' && birdWhatsApp;
    const maintenanceTelegram =
      env.MAINTENANCE_TELEGRAM_ENABLED === 'true' && telegramBot;
    const maintenanceSms =
      env.MAINTENANCE_SMS_ENABLED === 'true' && birdSms;

    return {
      email:
        Boolean(this.config.get<string>('SMTP_USER')?.trim()) ||
        Boolean(this.config.get<string>('MAILERSEND_API_KEY')?.trim()),
      whatsapp: maintenanceWhatsApp,
      telegram: maintenanceTelegram,
      sms: maintenanceSms || twilioSms,
      birdSms,
      twilioSms,
    };
  }

  private async ensureSettings(): Promise<MaintenanceAlertSettingsDocument> {
    return this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            alertsEnabled: false,
            emailRecipients: [],
            whatsappEnabled: false,
            telegramEnabled: false,
            smsNotifierEnabled: false,
            alertPhones: [],
            telegramChatIds: [],
            cooldownMinutes: 15,
            smsEngine: SmsEngineEnum.BIRD,
            lastAlertStates: {},
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  private toResponse(
    doc: MaintenanceAlertSettingsDocument,
  ): MaintenanceAlertSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      alertsEnabled: doc.alertsEnabled === true,
      emailRecipients: doc.emailRecipients ?? [],
      whatsappEnabled: doc.whatsappEnabled === true,
      telegramEnabled: doc.telegramEnabled === true,
      smsNotifierEnabled: doc.smsNotifierEnabled === true,
      alertPhones: doc.alertPhones ?? [],
      telegramChatIds: doc.telegramChatIds ?? [],
      cooldownMinutes: doc.cooldownMinutes ?? 15,
      smsEngine:
        doc.smsEngine === SmsEngineEnum.TWILIO
          ? SmsEngineEnum.TWILIO
          : SmsEngineEnum.BIRD,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
      channelAvailability: this.getChannelAvailability(),
    };
  }
}

function normalizeEmails(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const email = item.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException(`invalid_email:${email}`);
    }
    seen.add(email);
    out.push(email);
  }
  return out;
}

function normalizePhones(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const phone = item.trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
}

function normalizeTelegramIds(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
