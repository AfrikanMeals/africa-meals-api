import { NotificationsService } from '@modules/notifications/notifications.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  phoneToSmsE164,
} from '@modules/ads/bird-channels.util';
import { SmsDispatchService } from '@modules/messaging/sms-dispatch.service';
import { RegionPricingService } from '@modules/supported-countries/region-pricing.service';
import { countryCodeFromStoreRegion } from '@modules/supported-countries/region-tax.util';
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
import { resolveStoreOrderNotifyPushFanout } from './vendor-notification-dispatch-recipients.util';

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
    private readonly smsDispatch: SmsDispatchService,
    private readonly regionPricing: RegionPricingService,
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

    const storeTeamIds =
      await this.storeAccess.listStoreTeamRecipientUserIds(sid);
    const platformAdminIds =
      await this.storeAccess.listPlatformOrderPushRecipientUserIds();
    const customerId = args.customerUserId?.trim() ?? '';

    const pushEnabled = await this.prefs.isChannelEnabled(
      sid,
      args.category,
      'push',
    );

    // Fix: Push boutique OFF ne coupe plus les admins ; admins toujours audience=admin.
    const fanout = resolveStoreOrderNotifyPushFanout({
      storeTeamIds,
      platformAdminIds,
      customerUserId: customerId,
      storePushEnabled: pushEnabled,
    });

    /** Inbox équipe si canal ON ; admins toujours (même si la boutique a coupé Push). */
    if (args.onInbox && fanout.inboxUserIds.length > 0) {
      void args.onInbox(fanout.inboxUserIds).catch((err) =>
        this.logger.warn(
          `${args.logTag} inbox: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }

    // Dual FCM : équipe (vendor) si Push ON + admins (admin) toujours.
    if (args.push) {
      const pushPayload = args.push;
      const sendBatch = async (
        userIds: string[],
        audience: 'vendor' | 'admin',
      ): Promise<void> => {
        if (userIds.length === 0) return;
        try {
          await this.notifications.pushVendorOrderNotify({
            vendorUserIds: userIds,
            title: pushPayload.title,
            body: pushPayload.body,
            orderId: pushPayload.orderId ?? '',
            storeId: sid,
            storeName: pushPayload.storeName,
            reason: pushPayload.reason ?? args.category,
            status: pushPayload.status ?? '',
            audience,
          });
          for (const userId of userIds) {
            await this.recordDelivery({
              storeId: sid,
              recipientUserId: userId,
              category: args.category,
              channel: 'push',
              status: VendorNotificationDeliveryStatusEnum.SENT,
              title: pushPayload.title,
              body: pushPayload.body,
              metadata: args.metadata,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          for (const userId of userIds) {
            await this.recordDelivery({
              storeId: sid,
              recipientUserId: userId,
              category: args.category,
              channel: 'push',
              status: VendorNotificationDeliveryStatusEnum.FAILED,
              title: pushPayload.title,
              body: pushPayload.body,
              errorMessage: msg,
              metadata: args.metadata,
            });
          }
          this.logger.warn(`FCM ${audience} ${args.logTag}: ${msg}`);
        }
      };

      void (async () => {
        await sendBatch(fanout.vendorFcmUserIds, 'vendor');
        await sendBatch(fanout.adminFcmUserIds, 'admin');
      })();

      // Push boutique OFF et aucun admin : journaliser le skip équipe.
      if (
        !pushEnabled &&
        fanout.vendorFcmUserIds.length === 0 &&
        fanout.adminFcmUserIds.length === 0
      ) {
        await this.recordDelivery({
          storeId: sid,
          category: args.category,
          channel: 'push',
          status: VendorNotificationDeliveryStatusEnum.SKIPPED,
          title: pushPayload.title,
          body: pushPayload.body,
          skipReason: 'channel_disabled',
          metadata: args.metadata,
        });
      }
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
    const pricing = await this.getPricingForStore(sid);
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
    // E-mails limités au propriétaire + équipe boutique — jamais aux admins
    // plateforme (sinon chaque changement de statut spamme tous les admins).
    const userIds = await this.storeAccess.listStoreTeamRecipientUserIds(
      args.storeId,
    );
    const seen = new Set<string>();
    const appName =
      this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';

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

    const res = await this.smsDispatch.sendSms({
      toPhone: phone,
      body: args.body,
      defaultCountryCode: defaultCc,
    });
    if (!res.ok) {
      await this.recordDelivery({
        storeId: args.storeId,
        category: args.category,
        channel: 'sms',
        status: VendorNotificationDeliveryStatusEnum.FAILED,
        body: args.body,
        errorMessage: res.error ?? `sms_not_configured_${res.engine ?? 'unknown'}`,
        metadata: args.metadata,
      });
      if (res.error && res.error !== 'invalid_phone') {
        this.logger.warn(`${args.logTag} sms (${res.engine}): ${res.error}`);
      }
      return;
    }

    await this.recordDelivery({
      storeId: args.storeId,
      category: args.category,
      channel: 'sms',
      status: VendorNotificationDeliveryStatusEnum.SENT,
      body: args.body,
      unitCostCad: args.unitCostCad,
      externalId: res.messageId ?? null,
      metadata: args.metadata,
    });
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
    const pricing = await this.getPricingForStore(args.storeId);
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

  async getPricing(countryCode?: string | null): Promise<{
    currency: string;
    smsUnitCostCad: number;
    smsEnabled: boolean;
    billingCyclePeriod: VendorNotificationBillingCyclePeriodEnum;
    regionCode?: string;
  }> {
    return this.regionPricing.getLegacyVendorSmsPricingPayload(countryCode);
  }

  async getPricingForStore(storeId: string): Promise<{
    currency: string;
    smsUnitCostCad: number;
    smsEnabled: boolean;
    billingCyclePeriod: VendorNotificationBillingCyclePeriodEnum;
    regionCode?: string;
  }> {
    const sid = storeId?.trim();
    if (!sid || !Types.ObjectId.isValid(sid)) {
      return this.getPricing();
    }
    const store = await this.storeModel
      .findById(sid)
      .populate('address', 'countryCode')
      .lean()
      .exec();
    const regionCode = countryCodeFromStoreRegion(store);
    return this.getPricing(regionCode || null);
  }

  async updatePricing(
    input: {
      currency?: string;
      smsUnitCostCad?: number;
      smsEnabled?: boolean;
      billingCyclePeriod?: VendorNotificationBillingCyclePeriodEnum;
    },
    countryCode?: string | null,
  ) {
    const code = await this.regionPricing.resolveRegionCode(countryCode);
    return this.regionPricing.saveVendorSmsPricing(code, input);
  }
}

export {
  billingMonthKey,
  billingPeriodKey,
  previousBillingMonthKey,
  previousBillingPeriodKey,
} from './vendor-notification-billing-period.util';
