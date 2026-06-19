import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@modules/mailer/mailer.service';
import {
  phoneToBirdE164,
  readBirdWhatsAppConfig,
  sendBirdWhatsAppTextMessage,
} from '@modules/ads/bird-channels.util';
import {
  readTelegramBotConfig,
  sendTelegramBotMessage,
} from '@modules/messaging/telegram-bot.util';
import { MaintenanceAlertSettingsDocument } from '@schemas/maintenance-alert-settings.schema';
import { SmsDispatchService } from '@modules/messaging/sms-dispatch.service';

export type ServiceAlertEvent = {
  kind: 'incident' | 'recovery';
  serviceKey: string;
  label: string;
  status: string;
  previousStatus?: string;
  details: string;
  checkedAt: string;
};

@Injectable()
export class MaintenanceAlertNotifierService {
  private readonly logger = new Logger(MaintenanceAlertNotifierService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly smsDispatch: SmsDispatchService,
  ) {}

  async notify(
    settings: MaintenanceAlertSettingsDocument,
    event: ServiceAlertEvent,
  ): Promise<void> {
    const subject = buildSubject(event);
    const textBody = buildTextBody(event);
    const htmlBody = buildHtmlBody(event);

    if (settings.emailRecipients?.length) {
      await this.sendEmails(settings.emailRecipients, subject, htmlBody, textBody);
    }

    const env = process.env;
    const defaultCc =
      env.MAINTENANCE_ALERT_DEFAULT_COUNTRY_CODE?.trim() ||
      env.AD_NOTIFICATION_SMS_DEFAULT_COUNTRY_CODE?.trim() ||
      '1';

    if (
      settings.whatsappEnabled &&
      env.MAINTENANCE_WHATSAPP_ENABLED === 'true' &&
      settings.alertPhones?.length
    ) {
      await this.sendWhatsApp(settings.alertPhones, textBody, defaultCc);
    }

    if (
      settings.telegramEnabled &&
      env.MAINTENANCE_TELEGRAM_ENABLED === 'true' &&
      settings.telegramChatIds?.length
    ) {
      await this.sendTelegram(settings.telegramChatIds, textBody);
    }

    if (
      settings.smsNotifierEnabled &&
      env.MAINTENANCE_SMS_ENABLED === 'true' &&
      settings.alertPhones?.length
    ) {
      await this.sendSmsAlerts(settings.alertPhones, textBody, defaultCc);
    }
  }

  private async sendEmails(
    recipients: string[],
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    for (const to of recipients) {
      try {
        await this.mailer.sendSimple({
          to,
          subject,
          html,
          text,
          logContext: 'maintenance-alert',
        });
      } catch (e) {
        this.logger.warn(
          `Maintenance alert email to ${to}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  private async sendWhatsApp(
    phones: string[],
    body: string,
    defaultCc: string,
  ): Promise<void> {
    const config = readBirdWhatsAppConfig(process.env);
    if (!config) {
      this.logger.warn('Maintenance WhatsApp: canal Bird non configuré');
      return;
    }
    for (const phone of phones) {
      const to = phoneToBirdE164(phone, defaultCc);
      if (!to) continue;
      try {
        await sendBirdWhatsAppTextMessage({
          config,
          to,
          body: body.slice(0, 4096),
        });
      } catch (e) {
        this.logger.warn(
          `Maintenance WhatsApp ${phone}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  private async sendTelegram(chatIds: string[], body: string): Promise<void> {
    const config = readTelegramBotConfig(process.env);
    if (!config) {
      this.logger.warn('Maintenance Telegram: TELEGRAM_BOT_TOKEN manquant');
      return;
    }
    for (const chatId of chatIds) {
      try {
        await sendTelegramBotMessage({
          config,
          chatId,
          text: body.slice(0, 4096),
        });
      } catch (e) {
        this.logger.warn(
          `Maintenance Telegram ${chatId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  private async sendSmsAlerts(
    phones: string[],
    body: string,
    defaultCc: string,
  ): Promise<void> {
    for (const phone of phones) {
      const res = await this.smsDispatch.sendSms({
        toPhone: phone,
        body: body.slice(0, 1600),
        defaultCountryCode: defaultCc,
      });
      if (!res.ok) {
        this.logger.warn(
          `Maintenance SMS ${phone} (${res.engine ?? 'unknown'}): ${res.error ?? 'failed'}`,
        );
      }
    }
  }
}

function buildSubject(event: ServiceAlertEvent): string {
  const appName = process.env.APP_NAME?.trim() || 'Wise Eat';
  if (event.kind === 'recovery') {
    return `[${appName}] ✅ Rétabli — ${event.label}`;
  }
  return `[${appName}] 🚨 Alerte infra — ${event.label} (${event.status})`;
}

function buildTextBody(event: ServiceAlertEvent): string {
  const lines = [
    event.kind === 'recovery'
      ? `Service rétabli : ${event.label}`
      : `Incident détecté : ${event.label}`,
    `Statut : ${event.status}`,
  ];
  if (event.previousStatus) {
    lines.push(`Statut précédent : ${event.previousStatus}`);
  }
  lines.push(`Cause / détails : ${event.details}`);
  lines.push(`Vérifié à : ${event.checkedAt}`);
  lines.push(`Clé : ${event.serviceKey}`);
  return lines.join('\n');
}

function buildHtmlBody(event: ServiceAlertEvent): string {
  const title =
    event.kind === 'recovery'
      ? `Service rétabli — ${escapeHtml(event.label)}`
      : `Incident — ${escapeHtml(event.label)}`;
  const statusColor =
    event.kind === 'recovery'
      ? '#059669'
      : event.status === 'down'
        ? '#dc2626'
        : '#d97706';
  return [
    `<h2 style="margin:0 0 12px;color:${statusColor}">${title}</h2>`,
    `<p><strong>Statut :</strong> ${escapeHtml(event.status)}</p>`,
    event.previousStatus
      ? `<p><strong>Statut précédent :</strong> ${escapeHtml(event.previousStatus)}</p>`
      : '',
    `<p><strong>Cause / détails :</strong><br/>${escapeHtml(event.details).replace(/\n/g, '<br/>')}</p>`,
    `<p style="color:#6b7280;font-size:13px">Vérifié à ${escapeHtml(event.checkedAt)} · ${escapeHtml(event.serviceKey)}</p>`,
  ]
    .filter(Boolean)
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
