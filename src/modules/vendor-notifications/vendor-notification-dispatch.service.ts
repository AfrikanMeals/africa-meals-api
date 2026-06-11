import { NotificationsService } from '@modules/notifications/notifications.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  phoneToSmsE164,
  readTwilioSmsConfig,
  sendTwilioSmsMessage,
} from '@modules/ads/twilio-sms.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  VendorNotificationDeliveryModel,
  VendorNotificationDeliveryStatusEnum,
} from '@schemas/vendor-notification-delivery.schema';
import { VendorNotificationPricingSettingsModel } from '@schemas/vendor-notification-pricing-settings.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  type VendorNotificationCategory,
  type VendorNotificationChannel,
} from './vendor-notification.constants';
import { VendorNotificationPreferencesService } from './vendor-notification-preferences.service';
import {
  billingPeriodKey,
  normalizeBillingCyclePeriod,
  previousBillingMonthKey,
  VendorNotificationBillingCyclePeriodEnum,
} from './vendor-notification-billing-period.util';

export type VendorStoreNotifyPush = {
  title: string;
  body: string;
  orderId?: string;
  storeName?: string;
  reason?: string;
  status?: string;
};

export type VendorStoreNotifyEmail = {
  subject: string;
  heading: string;
  body: string;
  infoRows: Array<{ label: string; value: string }>;
};

@Injectable()
export class VendorNotificationDispatchService {
  private readonly logger = new Logger(VendorNotificationDispatchService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prefs: VendorNotificationPreferencesService,
    private readonly storeAccess: StoreAccessService,
    private readonly notifications: NotificationsService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    @InjectModel(VendorNotificationDeliveryModel.name)
    private readonly deliveryModel: Model<VendorNotificationDeliveryModel>,
    @InjectModel(VendorNotificationPricingSettingsModel.name)
    private readonly pricingModel: Model<VendorNotificationPricingSettingsModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
  ) {}

  async notifyStoreVendors(args: {
    storeId: string;
    category: VendorNotificationCategory;
    customerUserId?: string | null;
    inboxMessage?: string;
    push?: VendorStoreNotifyPush;
    email?: VendorStoreNotifyEmail;
    smsBody?: string;
    metadata?: Record<string, string>;
    logTag: string;
    onInbox?: (notifyUserIds: string[]) => Promise<void>;
  }): Promise<void> {
    const sid = args.storeId?.trim();
    if (!sid || !Types.ObjectId.isValid(sid)) return;

    const allVendorIds =
      await this.storeAccess.listStorePushRecipientUserIds(sid);
    const customerId = args.customerUserId?.trim() ?? '';
    const pushIds =
      customerId && Types.ObjectId.isValid(customerId)
        ? allVendorIds.filter((id) => id !== customerId)
        : allVendorIds;

    if (args.onInbox) {
      const inboxNotifyIds =
        allVendorIds.length > 0
          ? allVendorIds
          : customerId && Types.ObjectId.isValid(customerId)
            ? [customerId]
            : [];
      void args.onInbox(inboxNotifyIds).catch((err) =>
        this.logger.warn(
          `${args.logTag} inbox: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }

    const pushEnabled = await this.prefs.isChannelEnabled(
      sid,
      args.category,
      'push',
    );
    if (args.push && pushEnabled && pushIds.length > 0) {
      void this.notifications
        .pushVendorOrderNotify({
          vendorUserIds: pushIds,
          title: args.push.title,
          body: args.push.body,
          orderId: args.push.orderId ?? '',
          storeName: args.push.storeName,
          reason: args.push.reason ?? args.category,
          status: args.push.status ?? '',
        })
        .then(async () => {
          for (const userId of pushIds) {
            await this.recordDelivery({
              storeId: sid,
              recipientUserId: userId,
              category: args.category,
              channel: 'push',
              status: VendorNotificationDeliveryStatusEnum.SENT,
              title: args.push!.title,
              body: args.push!.body,
              metadata: args.metadata,
            });
          }
        })
        .catch(async (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          for (const userId of pushIds) {
            await this.recordDelivery({
              storeId: sid,
              recipientUserId: userId,
              category: args.category,
              channel: 'push',
              status: VendorNotificationDeliveryStatusEnum.FAILED,
              title: args.push!.title,
              body: args.push!.body,
              errorMessage: msg,
              metadata: args.metadata,
            });
          }
          this.logger.warn(`FCM vendor ${args.logTag}: ${msg}`);
        });
    } else if (args.push && !pushEnabled) {
      await this.recordDelivery({
        storeId: sid,
        category: args.category,
        channel: 'push',
        status: VendorNotificationDeliveryStatusEnum.SKIPPED,
        title: args.push.title,
        body: args.push.body,
        skipReason: 'channel_disabled',
        metadata: args.metadata,
      });
    }

    const emailEnabled = await this.prefs.isChannelEnabled(
      sid,
      args.category,
      'email',
    );
    if (args.email && emailEnabled) {
      void this.sendEmailsToStore({
        storeId: sid,
        category: args.category,
        email: args.email,
        metadata: args.metadata,
        logTag: args.logTag,
      });
    } else if (args.email && !emailEnabled) {
      await this.recordDelivery({
        storeId: sid,
        category: args.category,
        channel: 'email',
        status: VendorNotificationDeliveryStatusEnum.SKIPPED,
        title: args.email.subject,
        body: args.email.body,
        skipReason: 'channel_disabled',
        metadata: args.metadata,
      });
    }

    const smsEnabledPref = await this.prefs.isChannelEnabled(
      sid,
      args.category,
      'sms',
    );
    const pricing = await this.getPricing();
    if (args.smsBody?.trim() && smsEnabledPref && pricing.smsEnabled) {
      void this.sendSmsToStore({
        storeId: sid,
        category: args.category,
        body: args.smsBody.trim(),
        unitCostCad: pricing.smsUnitCostCad,
        metadata: args.metadata,
        logTag: args.logTag,
      });
    } else if (args.smsBody?.trim()) {
      const billing = await this.prefs.getBillingState(sid);
      const skipReason = billing.smsBillingSuspended
        ? 'sms_billing_unpaid'
        : !smsEnabledPref
          ? 'channel_disabled'
          : 'sms_globally_disabled';
      await this.recordDelivery({
        storeId: sid,
        category: args.category,
        channel: 'sms',
        status: VendorNotificationDeliveryStatusEnum.SKIPPED,
        body: args.smsBody,
        skipReason,
        metadata: args.metadata,
      });
    }
  }

  private async sendEmailsToStore(args: {
    storeId: string;
    category: VendorNotificationCategory;
    email: VendorStoreNotifyEmail;
    metadata?: Record<string, string>;
    logTag: string;
  }): Promise<void> {
    const userIds = await this.storeAccess.listStorePushRecipientUserIds(
      args.storeId,
    );
    const seen = new Set<string>();
    const appName =
      this.config.get<string>('APP_NAME')?.trim() || 'Afrika Meals';

    for (const userId of userIds) {
      if (!Types.ObjectId.isValid(userId)) continue;
      const user = await this.userModel
        .findById(userId)
        .select('fullName email')
        .lean()
        .exec();
      const email = String(user?.email ?? '')
        .trim()
        .toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const name = String(user?.fullName ?? '').trim() || 'Bonjour';
      const safeName = this.emailTpl.escapeHtml(name);
      const safeBody = this.emailTpl.escapeHtml(args.email.body);
      const html = [
        this.emailTpl.heading(args.email.heading),
        this.emailTpl.paragraph(`Bonjour <strong>${safeName}</strong>,`),
        this.emailTpl.paragraph(safeBody),
        this.emailTpl.infoPanel(this.emailTpl.keyValues(args.email.infoRows)),
        this.emailTpl.muted(
          'Pour toute question, contactez le support via les coordonnées en bas de ce message.',
        ),
      ].join('\n');
      const text = [
        `Bonjour ${name},`,
        '',
        args.email.body,
        '',
        ...args.email.infoRows.map((r) => `${r.label} : ${r.value}`),
        '',
        `— L'équipe ${appName}`,
      ].join('\n');

      try {
        await this.mailer.sendSimple({
          to: email,
          toName: name,
          subject: `${appName} — ${args.email.subject}`,
          html,
          text,
        });
        await this.recordDelivery({
          storeId: args.storeId,
          recipientUserId: userId,
          category: args.category,
          channel: 'email',
          status: VendorNotificationDeliveryStatusEnum.SENT,
          title: args.email.subject,
          body: args.email.body,
          metadata: args.metadata,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.recordDelivery({
          storeId: args.storeId,
          recipientUserId: userId,
          category: args.category,
          channel: 'email',
          status: VendorNotificationDeliveryStatusEnum.FAILED,
          title: args.email.subject,
          body: args.email.body,
          errorMessage: msg,
          metadata: args.metadata,
        });
        this.logger.warn(`${args.logTag} email=${email}: ${msg}`);
      }
    }
  }

  private async sendSmsToStore(args: {
    storeId: string;
    category: VendorNotificationCategory;
    body: string;
    unitCostCad: number;
    metadata?: Record<string, string>;
    logTag: string;
  }): Promise<void> {
    const store = await this.storeModel
      .findById(args.storeId)
      .select('phoneNumber name')
      .lean()
      .exec();
    const phone = String(store?.phoneNumber ?? '').trim();
    const defaultCc =
      this.config.get<string>('VENDOR_NOTIFICATION_SMS_DEFAULT_COUNTRY_CODE')?.trim() ||
      this.config.get<string>('AD_NOTIFICATION_SMS_DEFAULT_COUNTRY_CODE')?.trim() ||
      '1';
    const to = phoneToSmsE164(phone, defaultCc);
    if (!to) {
      await this.recordDelivery({
        storeId: args.storeId,
        category: args.category,
        channel: 'sms',
        status: VendorNotificationDeliveryStatusEnum.SKIPPED,
        body: args.body,
        skipReason: 'missing_store_phone',
        metadata: args.metadata,
      });
      return;
    }

    const twilio = readTwilioSmsConfig(process.env);
    if (!twilio) {
      await this.recordDelivery({
        storeId: args.storeId,
        category: args.category,
        channel: 'sms',
        status: VendorNotificationDeliveryStatusEnum.FAILED,
        body: args.body,
        errorMessage: 'twilio_not_configured',
        metadata: args.metadata,
      });
      return;
    }

    try {
      const res = await sendTwilioSmsMessage({
        config: twilio,
        to,
        body: args.body,
      });
      await this.recordDelivery({
        storeId: args.storeId,
        category: args.category,
        channel: 'sms',
        status: VendorNotificationDeliveryStatusEnum.SENT,
        body: args.body,
        unitCostCad: args.unitCostCad,
        externalId: res.sid,
        metadata: args.metadata,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.recordDelivery({
        storeId: args.storeId,
        category: args.category,
        channel: 'sms',
        status: VendorNotificationDeliveryStatusEnum.FAILED,
        body: args.body,
        errorMessage: msg,
        metadata: args.metadata,
      });
      this.logger.warn(`${args.logTag} sms: ${msg}`);
    }
  }

  async recordDelivery(args: {
    storeId: string;
    recipientUserId?: string | null;
    category: VendorNotificationCategory;
    channel: VendorNotificationChannel;
    status: VendorNotificationDeliveryStatusEnum;
    title?: string;
    body?: string;
    unitCostCad?: number | null;
    externalId?: string | null;
    skipReason?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, string>;
    deliveredAt?: Date;
  }): Promise<void> {
    const deliveredAt = args.deliveredAt ?? new Date();
    const pricing = await this.getPricing();
    await this.deliveryModel.create({
      store: new Types.ObjectId(args.storeId),
      recipientUser:
        args.recipientUserId && Types.ObjectId.isValid(args.recipientUserId)
          ? new Types.ObjectId(args.recipientUserId)
          : null,
      category: args.category,
      channel: args.channel,
      status: args.status,
      title: args.title ?? '',
      body: args.body ?? '',
      unitCostCad: args.unitCostCad ?? null,
      externalId: args.externalId ?? null,
      skipReason: args.skipReason ?? null,
      errorMessage: args.errorMessage ?? null,
      metadata: args.metadata ?? {},
      deliveredAt,
      billingMonth: billingPeriodKey(
        deliveredAt,
        pricing.billingCyclePeriod,
      ),
    });
  }

  async getPricing(): Promise<{
    currency: string;
    smsUnitCostCad: number;
    smsEnabled: boolean;
    billingCyclePeriod: VendorNotificationBillingCyclePeriodEnum;
  }> {
    const doc = await this.pricingModel.findOne({ key: 'default' }).lean().exec();
    return {
      currency: String(doc?.currency ?? 'CAD').trim() || 'CAD',
      smsUnitCostCad: Number(doc?.smsUnitCostCad ?? 0.08) || 0,
      smsEnabled: doc?.smsEnabled !== false,
      billingCyclePeriod: normalizeBillingCyclePeriod(doc?.billingCyclePeriod),
    };
  }

  async updatePricing(input: {
    currency?: string;
    smsUnitCostCad?: number;
    smsEnabled?: boolean;
    billingCyclePeriod?: VendorNotificationBillingCyclePeriodEnum;
  }) {
    const current = await this.getPricing();
    const next = {
      currency: input.currency?.trim() || current.currency,
      smsUnitCostCad:
        input.smsUnitCostCad != null
          ? Math.max(0, Number(input.smsUnitCostCad) || 0)
          : current.smsUnitCostCad,
      smsEnabled: input.smsEnabled ?? current.smsEnabled,
      billingCyclePeriod: input.billingCyclePeriod
        ? normalizeBillingCyclePeriod(input.billingCyclePeriod)
        : current.billingCyclePeriod,
    };
    await this.pricingModel
      .findOneAndUpdate(
        { key: 'default' },
        { $set: next },
        { upsert: true, new: true },
      )
      .exec();
    return next;
  }
}

export {
  billingMonthKey,
  billingPeriodKey,
  previousBillingMonthKey,
  previousBillingPeriodKey,
} from './vendor-notification-billing-period.util';
