import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MailerService } from '@modules/mailer/mailer.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { AdminOpsReportBuilderService } from '@modules/admin-ops-reports/admin-ops-report-builder.service';
import {
  resolveCompletedOpsReportPeriod,
  shouldSendOpsReportNow,
} from '@modules/admin-ops-reports/admin-ops-report-period.util';
import {
  AdminOpsReportPeriodEnum,
  AdminOpsReportSettingsModel,
} from '@schemas/admin-ops-report-settings.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';

const SETTINGS_KEY = 'default';

export type AdminOpsReportSettingsResponse = {
  enabled: boolean;
  period: AdminOpsReportPeriodEnum;
  recipientEmails: string[];
  timezone: string;
  sendHourLocal: number;
  lastSentAt: string | null;
  lastSentPeriodKey: string | null;
  updatedAt: string | null;
  nextPeriodPreview: {
    from: string;
    to: string;
    periodKey: string;
    labelFr: string;
  };
};

@Injectable()
export class AdminOpsReportsService {
  private readonly logger = new Logger(AdminOpsReportsService.name);

  constructor(
    @InjectModel(AdminOpsReportSettingsModel.name)
    private readonly settingsModel: Model<AdminOpsReportSettingsModel>,
    private readonly storeAccess: StoreAccessService,
    private readonly builder: AdminOpsReportBuilderService,
    private readonly mailer: MailerService,
  ) {}

  private async assertAdminSettings(user: UserModel): Promise<void> {
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private normalizeEmails(raw: string[] | undefined): string[] {
    const out = new Set<string>();
    for (const e of raw ?? []) {
      const v = String(e ?? '')
        .trim()
        .toLowerCase();
      if (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) out.add(v);
    }
    return [...out].slice(0, 20);
  }

  private toResponse(
    doc: AdminOpsReportSettingsModel & { updatedAt?: Date },
  ): AdminOpsReportSettingsResponse {
    const period = doc.period ?? AdminOpsReportPeriodEnum.WEEKLY;
    const tz = String(doc.timezone ?? 'America/Toronto').trim() || 'America/Toronto';
    const preview = resolveCompletedOpsReportPeriod(period, tz);
    return {
      enabled: doc.enabled === true,
      period,
      recipientEmails: this.normalizeEmails(doc.recipientEmails),
      timezone: tz,
      sendHourLocal: Math.max(0, Math.min(23, Math.trunc(doc.sendHourLocal ?? 8))),
      lastSentAt: doc.lastSentAt?.toISOString?.() ?? null,
      lastSentPeriodKey: doc.lastSentPeriodKey ?? null,
      updatedAt: doc.updatedAt?.toISOString?.() ?? null,
      nextPeriodPreview: {
        from: preview.from,
        to: preview.to,
        periodKey: preview.periodKey,
        labelFr: preview.labelFr,
      },
    };
  }

  private async ensureSettings(): Promise<AdminOpsReportSettingsModel> {
    return this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            enabled: false,
            period: AdminOpsReportPeriodEnum.WEEKLY,
            recipientEmails: [],
            timezone: 'America/Toronto',
            sendHourLocal: 8,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async getSettings(user: UserModel): Promise<AdminOpsReportSettingsResponse> {
    await this.assertAdminSettings(user);
    const doc = await this.ensureSettings();
    return this.toResponse(doc);
  }

  async updateSettings(
    user: UserModel,
    input: {
      enabled?: boolean;
      period?: AdminOpsReportPeriodEnum;
      recipientEmails?: string[];
      timezone?: string;
      sendHourLocal?: number;
    },
  ): Promise<AdminOpsReportSettingsResponse> {
    await this.assertAdminSettings(user);
    const $set: Record<string, unknown> = {};
    if (input.enabled !== undefined) $set.enabled = input.enabled === true;
    if (input.period !== undefined) $set.period = input.period;
    if (input.recipientEmails !== undefined) {
      $set.recipientEmails = this.normalizeEmails(input.recipientEmails);
    }
    if (input.timezone !== undefined) {
      const tz = String(input.timezone).trim();
      if (tz) $set.timezone = tz;
    }
    if (input.sendHourLocal !== undefined) {
      $set.sendHourLocal = Math.max(
        0,
        Math.min(23, Math.trunc(input.sendHourLocal)),
      );
    }

    const doc = await this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set, $setOnInsert: { key: SETTINGS_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.toResponse(doc);
  }

  async sendReportNow(
    user: UserModel,
  ): Promise<{ sent: boolean; recipients: string[]; periodKey: string }> {
    await this.assertAdminSettings(user);
    const doc = await this.ensureSettings();
    const emails = this.normalizeEmails(doc.recipientEmails);
    if (!emails.length) {
      throw new BadRequestException('ops_report_no_recipients');
    }
    const tz = String(doc.timezone ?? 'America/Toronto').trim() || 'America/Toronto';
    const period = doc.period ?? AdminOpsReportPeriodEnum.WEEKLY;
    const bounds = resolveCompletedOpsReportPeriod(period, tz);
    await this.deliverReport(bounds, emails);
    await this.markSent(bounds.periodKey);
    return { sent: true, recipients: emails, periodKey: bounds.periodKey };
  }

  async runScheduledPass(): Promise<{
    sent: boolean;
    periodKey: string | null;
    recipients: number;
  }> {
    const doc = await this.ensureSettings();
    const emails = this.normalizeEmails(doc.recipientEmails);
    const decision = shouldSendOpsReportNow({
      enabled: doc.enabled === true,
      period: doc.period ?? AdminOpsReportPeriodEnum.WEEKLY,
      timezone: doc.timezone ?? 'America/Toronto',
      sendHourLocal: doc.sendHourLocal ?? 8,
      lastSentPeriodKey: doc.lastSentPeriodKey ?? null,
    });
    if (!decision.send || !decision.bounds || !emails.length) {
      return { sent: false, periodKey: decision.bounds?.periodKey ?? null, recipients: 0 };
    }
    try {
      await this.deliverReport(decision.bounds, emails);
      await this.markSent(decision.bounds.periodKey);
      this.logger.log(
        `Ops report sent (${decision.bounds.periodKey}) to ${emails.length} recipient(s)`,
      );
      return {
        sent: true,
        periodKey: decision.bounds.periodKey,
        recipients: emails.length,
      };
    } catch (e) {
      this.logger.error(
        `Ops report cron failed: ${
          e instanceof Error ? e.stack ?? e.message : String(e)
        }`,
      );
      return { sent: false, periodKey: decision.bounds.periodKey, recipients: 0 };
    }
  }

  private async deliverReport(
    bounds: ReturnType<typeof resolveCompletedOpsReportPeriod>,
    recipients: string[],
  ): Promise<void> {
    const built = await this.builder.build(bounds);
    const appName =
      process.env.APP_NAME?.trim() || 'Africa Meals';
    const subject = `[${appName}] Rapport opérations — ${bounds.labelFr}`;
    const text = `Rapport opérations ${bounds.labelFr} (${bounds.from} → ${bounds.to}). Voir le fichier Excel joint.`;

    for (const to of recipients) {
      await this.mailer.sendSimple({
        to,
        subject,
        html: built.htmlSummary,
        text,
        attachments: [
          {
            filename: built.filename,
            content: built.workbook,
          },
        ],
      });
    }
  }

  private async markSent(periodKey: string): Promise<void> {
    await this.settingsModel
      .updateOne(
        { key: SETTINGS_KEY },
        {
          $set: {
            lastSentAt: new Date(),
            lastSentPeriodKey: periodKey,
          },
        },
      )
      .exec();
  }
}
