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
  groupStoresIntoVendorRecipients,
  VENDOR_OPS_REPORT_STORE_STATUSES,
  type VendorOpsReportRecipient,
  type VendorOpsReportStoreLean,
} from '@modules/admin-ops-reports/vendor-ops-report-recipients.util';
import {
  AdminOpsReportPeriodEnum,
  AdminOpsReportSettingsModel,
} from '@schemas/admin-ops-report-settings.schema';
import { StoreModel } from '@schemas/store.schema';
import { VendorOpsReportDeliveryModel } from '@schemas/vendor-ops-report-delivery.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

const SETTINGS_KEY = 'default';

export type AdminOpsReportSettingsResponse = {
  enabled: boolean;
  period: AdminOpsReportPeriodEnum;
  timezone: string;
  sendHourLocal: number;
  lastSentAt: string | null;
  lastSentPeriodKey: string | null;
  updatedAt: string | null;
  eligibleVendorCount: number;
  nextPeriodPreview: {
    from: string;
    to: string;
    periodKey: string;
    labelFr: string;
  };
};

export type VendorOpsReportRecipientLog = {
  ownerId: string;
  email: string;
  ccEmails: string[];
  fullName: string;
  storeCount: number;
  status: 'sent' | 'skipped' | 'failed';
  error?: string;
};

export type VendorOpsReportDispatchResult = {
  periodKey: string;
  sent: number;
  skipped: number;
  failed: number;
  errors: Array<{ ownerId: string; message: string }>;
  recipientLogs: VendorOpsReportRecipientLog[];
};

@Injectable()
export class AdminOpsReportsService {
  private readonly logger = new Logger(AdminOpsReportsService.name);

  constructor(
    @InjectModel(AdminOpsReportSettingsModel.name)
    private readonly settingsModel: Model<AdminOpsReportSettingsModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(VendorOpsReportDeliveryModel.name)
    private readonly deliveryModel: Model<VendorOpsReportDeliveryModel>,
    private readonly storeAccess: StoreAccessService,
    private readonly builder: AdminOpsReportBuilderService,
    private readonly mailer: MailerService,
  ) {}

  private async assertAdminSettings(user: UserModel): Promise<void> {
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private async listEligibleRecipients(): Promise<VendorOpsReportRecipient[]> {
    const stores = await this.storeModel
      .find({ status: { $in: VENDOR_OPS_REPORT_STORE_STATUSES } })
      .select('_id name owner email')
      .lean()
      .exec();
    const ownerIds = [
      ...new Set(
        stores
          .map((s) => String((s as { owner?: unknown }).owner ?? '').trim())
          .filter(Boolean),
      ),
    ];
    if (!ownerIds.length) return [];

    const users = await this.userModel
      .find({ _id: { $in: ownerIds } })
      .select('_id email fullName type')
      .lean()
      .exec();
    const usersById = new Map(
      users.map((u) => [String((u as { _id?: unknown })._id), u as Record<string, unknown>]),
    );
    return groupStoresIntoVendorRecipients(
      stores as VendorOpsReportStoreLean[],
      usersById,
    );
  }

  private toResponse(
    doc: AdminOpsReportSettingsModel & { updatedAt?: Date },
    eligibleVendorCount: number,
  ): AdminOpsReportSettingsResponse {
    const period = doc.period ?? AdminOpsReportPeriodEnum.WEEKLY;
    const tz = String(doc.timezone ?? 'America/Toronto').trim() || 'America/Toronto';
    const preview = resolveCompletedOpsReportPeriod(period, tz);
    return {
      enabled: doc.enabled === true,
      period,
      timezone: tz,
      sendHourLocal: Math.max(0, Math.min(23, Math.trunc(doc.sendHourLocal ?? 8))),
      lastSentAt: doc.lastSentAt?.toISOString?.() ?? null,
      lastSentPeriodKey: doc.lastSentPeriodKey ?? null,
      updatedAt: doc.updatedAt?.toISOString?.() ?? null,
      eligibleVendorCount,
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
    const [doc, recipients] = await Promise.all([
      this.ensureSettings(),
      this.listEligibleRecipients(),
    ]);
    return this.toResponse(doc, recipients.length);
  }

  async updateSettings(
    user: UserModel,
    input: {
      enabled?: boolean;
      period?: AdminOpsReportPeriodEnum;
      timezone?: string;
      sendHourLocal?: number;
    },
  ): Promise<AdminOpsReportSettingsResponse> {
    await this.assertAdminSettings(user);
    const $set: Record<string, unknown> = {};
    if (input.enabled !== undefined) $set.enabled = input.enabled === true;
    if (input.period !== undefined) $set.period = input.period;
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
    const recipients = await this.listEligibleRecipients();
    return this.toResponse(doc, recipients.length);
  }

  async sendReportNow(user: UserModel): Promise<VendorOpsReportDispatchResult> {
    await this.assertAdminSettings(user);
    const doc = await this.ensureSettings();
    const tz = String(doc.timezone ?? 'America/Toronto').trim() || 'America/Toronto';
    const period = doc.period ?? AdminOpsReportPeriodEnum.WEEKLY;
    const bounds = resolveCompletedOpsReportPeriod(period, tz);
    const adminEmail = String(user.email ?? '').trim() || '(sans e-mail)';
    this.logger.log(
      `[vendor-ops-report-manual] déclenché par admin=${String(user._id)} (${adminEmail}) période=${bounds.periodKey}`,
    );
    const result = await this.dispatchToVendors(bounds, {
      force: true,
      manual: true,
    });
    this.logger.log(
      `[vendor-ops-report-manual] terminé période=${bounds.periodKey} sent=${result.sent} skipped=${result.skipped} failed=${result.failed} destinataires=${result.recipientLogs.map((r) => `${r.email}[${r.status}]`).join(', ') || '(aucun)'}`,
    );
    if (result.sent > 0) {
      await this.markGlobalSent(bounds.periodKey);
    }
    return result;
  }

  async runScheduledPass(): Promise<VendorOpsReportDispatchResult & { ran: boolean }> {
    const doc = await this.ensureSettings();
    const decision = shouldSendOpsReportNow({
      enabled: doc.enabled === true,
      period: doc.period ?? AdminOpsReportPeriodEnum.WEEKLY,
      timezone: doc.timezone ?? 'America/Toronto',
      sendHourLocal: doc.sendHourLocal ?? 8,
      lastSentPeriodKey: doc.lastSentPeriodKey ?? null,
    });
    if (!decision.send || !decision.bounds) {
      return {
        ran: false,
        periodKey: decision.bounds?.periodKey ?? '',
        sent: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        recipientLogs: [],
      };
    }
    try {
      const result = await this.dispatchToVendors(decision.bounds, {
        force: false,
      });
      if (result.sent > 0) {
        await this.markGlobalSent(decision.bounds.periodKey);
      }
      if (result.sent > 0) {
        this.logger.log(
          `Vendor ops reports (${decision.bounds.periodKey}): sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`,
        );
      }
      return { ran: true, ...result };
    } catch (e) {
      this.logger.error(
        `Vendor ops report cron failed: ${
          e instanceof Error ? e.stack ?? e.message : String(e)
        }`,
      );
      return {
        ran: true,
        periodKey: decision.bounds.periodKey,
        sent: 0,
        skipped: 0,
        failed: 0,
        errors: [
          {
            ownerId: '',
            message: e instanceof Error ? e.message : String(e),
          },
        ],
        recipientLogs: [],
      };
    }
  }

  private logRecipientRoster(
    bounds: ReturnType<typeof resolveCompletedOpsReportPeriod>,
    recipients: VendorOpsReportRecipient[],
    context: string,
  ): void {
    if (!recipients.length) {
      this.logger.warn(
        `[${context}] période=${bounds.periodKey} — aucun propriétaire éligible`,
      );
      return;
    }
    for (const r of recipients) {
      const cc =
        r.ccEmails.length > 0 ? ` · cc=${r.ccEmails.join(', ')}` : '';
      this.logger.log(
        `[${context}] destinataire to=${r.email}${cc} · owner=${r.ownerId} · boutiques=${r.storeNames.length} (${r.storeNames.join(', ')})`,
      );
    }
    this.logger.log(
      `[${context}] période=${bounds.periodKey} · ${recipients.length} propriétaire(s) éligible(s)`,
    );
  }

  private async dispatchToVendors(
    bounds: ReturnType<typeof resolveCompletedOpsReportPeriod>,
    opts: { force: boolean; manual?: boolean },
  ): Promise<VendorOpsReportDispatchResult> {
    const logTag = opts.manual
      ? 'vendor-ops-report-manual'
      : 'vendor-ops-report';
    const recipients = await this.listEligibleRecipients();
    this.logRecipientRoster(bounds, recipients, logTag);

    if (!recipients.length) {
      throw new BadRequestException('ops_report_no_vendor_recipients');
    }

    const alreadySent = opts.force
      ? new Set<string>()
      : await this.ownersAlreadySentForPeriod(bounds.periodKey);

    const appName = process.env.APP_NAME?.trim() || 'Wise Eat';
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ ownerId: string; message: string }> = [];
    const recipientLogs: VendorOpsReportRecipientLog[] = [];

    for (const recipient of recipients) {
      const ownerKey = recipient.ownerId.toString();
      const baseLog: VendorOpsReportRecipientLog = {
        ownerId: ownerKey,
        email: recipient.email,
        ccEmails: recipient.ccEmails,
        fullName: recipient.fullName,
        storeCount: recipient.storeIds.length,
        status: 'sent',
      };

      if (!opts.force && alreadySent.has(ownerKey)) {
        skipped += 1;
        recipientLogs.push({ ...baseLog, status: 'skipped' });
        this.logger.log(
          `[${logTag}] ignoré (déjà envoyé) → ${recipient.email} owner=${ownerKey}`,
        );
        continue;
      }

      try {
        this.logger.log(
          `[${logTag}] préparation rapport → ${recipient.email} owner=${ownerKey}`,
        );
        const built = await this.builder.buildForVendor(recipient, bounds);
        const subject = `[${appName}] Rapport d'activité — ${bounds.labelFr}`;
        const text = `Votre rapport ${bounds.labelFr} (${bounds.from} → ${bounds.to}). Voir le fichier Excel joint.`;

        await this.mailer.sendSimple({
          to: recipient.email,
          toName: recipient.fullName,
          cc: recipient.ccEmails,
          subject,
          html: built.htmlSummary,
          text,
          logContext: logTag,
          attachments: [
            {
              filename: built.filename,
              content: built.workbook,
            },
          ],
        });

        await this.deliveryModel
          .updateOne(
            { owner: recipient.ownerId, periodKey: bounds.periodKey },
            {
              $set: {
                owner: recipient.ownerId,
                periodKey: bounds.periodKey,
                email: recipient.email,
                sentAt: new Date(),
              },
            },
            { upsert: true },
          )
          .exec();
        sent += 1;
        recipientLogs.push(baseLog);
        const ccNote =
          recipient.ccEmails.length > 0
            ? ` cc=${recipient.ccEmails.join(', ')}`
            : '';
        this.logger.log(
          `[${logTag}] livré → ${recipient.email}${ccNote} fichier=${built.filename}`,
        );
      } catch (e) {
        failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ ownerId: ownerKey, message });
        recipientLogs.push({ ...baseLog, status: 'failed', error: message });
        this.logger.warn(
          `[${logTag}] échec → ${recipient.email} owner=${ownerKey}: ${message}`,
        );
      }
    }

    return {
      periodKey: bounds.periodKey,
      sent,
      skipped,
      failed,
      errors: errors.slice(0, 20),
      recipientLogs,
    };
  }

  private async ownersAlreadySentForPeriod(
    periodKey: string,
  ): Promise<Set<string>> {
    const rows = await this.deliveryModel
      .find({ periodKey })
      .select('owner')
      .lean()
      .exec();
    return new Set(rows.map((r) => String((r as { owner?: unknown }).owner ?? '')));
  }

  private async markGlobalSent(periodKey: string): Promise<void> {
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
