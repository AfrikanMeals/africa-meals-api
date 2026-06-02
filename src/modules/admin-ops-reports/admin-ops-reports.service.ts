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

export type VendorOpsReportDispatchResult = {
  periodKey: string;
  sent: number;
  skipped: number;
  failed: number;
  errors: Array<{ ownerId: string; message: string }>;
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
      .select('_id name owner')
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
      stores as Array<{ _id?: Types.ObjectId; name?: string; owner?: Types.ObjectId }>,
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
    const result = await this.dispatchToVendors(bounds, { force: true });
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
      };
    }
  }

  private async dispatchToVendors(
    bounds: ReturnType<typeof resolveCompletedOpsReportPeriod>,
    opts: { force: boolean },
  ): Promise<VendorOpsReportDispatchResult> {
    const recipients = await this.listEligibleRecipients();
    if (!recipients.length) {
      throw new BadRequestException('ops_report_no_vendor_recipients');
    }

    const alreadySent = opts.force
      ? new Set<string>()
      : await this.ownersAlreadySentForPeriod(bounds.periodKey);

    const appName = process.env.APP_NAME?.trim() || 'Africa Meals';
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ ownerId: string; message: string }> = [];

    for (const recipient of recipients) {
      const ownerKey = recipient.ownerId.toString();
      if (!opts.force && alreadySent.has(ownerKey)) {
        skipped += 1;
        continue;
      }
      try {
        const built = await this.builder.buildForVendor(recipient, bounds);
        const subject = `[${appName}] Rapport d'activité — ${bounds.labelFr}`;
        const text = `Votre rapport ${bounds.labelFr} (${bounds.from} → ${bounds.to}). Voir le fichier Excel joint.`;

        await this.mailer.sendSimple({
          to: recipient.email,
          toName: recipient.fullName,
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
      } catch (e) {
        failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ ownerId: ownerKey, message });
        this.logger.warn(
          `Vendor ops report failed for owner ${ownerKey}: ${message}`,
        );
      }
    }

    return {
      periodKey: bounds.periodKey,
      sent,
      skipped,
      failed,
      errors: errors.slice(0, 20),
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
