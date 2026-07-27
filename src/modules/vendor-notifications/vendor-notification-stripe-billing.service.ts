import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { resolvePortalAppBaseUrl } from '@common/portal/portal-app-base-url.util';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  VendorNotificationMonthlyChargeModel,
  VendorNotificationChargeStatusEnum,
} from '@schemas/vendor-notification-monthly-charge.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import { VendorNotificationPreferencesService } from './vendor-notification-preferences.service';

type StripeClient = InstanceType<typeof Stripe>;

export const VENDOR_SMS_BILLING_CHECKOUT_KIND = 'vendor_sms_notification_billing';

@Injectable()
export class VendorNotificationStripeBillingService {
  private readonly logger = new Logger(VendorNotificationStripeBillingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    private readonly prefs: VendorNotificationPreferencesService,
    @InjectModel(VendorNotificationMonthlyChargeModel.name)
    private readonly chargeModel: Model<VendorNotificationMonthlyChargeModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
  ) {}

  private stripe(): StripeClient {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) throw new BadRequestException('stripe_not_configured');
    return new Stripe(key);
  }

  private graceDays(): number {
    const n = Number(
      this.config.get<string>('VENDOR_SMS_BILLING_GRACE_DAYS') ?? '7',
    );
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 7;
  }

  private successUrl(): string {
    const portalBase = resolvePortalAppBaseUrl({
      getEnv: (key) => this.config.get<string>(key),
      audience: 'business',
      localhostFallback: 'http://localhost:3001',
    });
    const configured = this.config
      .get<string>('VENDOR_SMS_BILLING_SUCCESS_URL')
      ?.trim();
    if (configured) return configured;
    return `${portalBase}/settings/notifications?sms_billing=success&session_id={CHECKOUT_SESSION_ID}`;
  }

  private cancelUrl(): string {
    const configured = this.config
      .get<string>('VENDOR_SMS_BILLING_CANCEL_URL')
      ?.trim();
    if (configured) return configured;
    const portalBase = resolvePortalAppBaseUrl({
      getEnv: (key) => this.config.get<string>(key),
      audience: 'business',
      localhostFallback: 'http://localhost:3001',
    });
    return `${portalBase}/settings/notifications?sms_billing=cancel`;
  }

  async issueStripeInvoicesForMonth(
    billingMonth: string,
  ): Promise<{ issued: number; skipped: number }> {
    const charges = await this.chargeModel
      .find({
        billingMonth,
        status: VendorNotificationChargeStatusEnum.PENDING,
        smsTotalCad: { $gt: 0 },
      })
      .lean()
      .exec();

    let issued = 0;
    let skipped = 0;
    for (const charge of charges) {
      try {
        const ok = await this.issueCheckoutForCharge(String(charge._id));
        if (ok) issued += 1;
        else skipped += 1;
      } catch (e) {
        skipped += 1;
        this.logger.warn(
          `SMS billing checkout failed charge=${charge._id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return { issued, skipped };
  }

  async issueCheckoutForCharge(chargeId: string): Promise<boolean> {
    const cid = chargeId.trim();
    if (!Types.ObjectId.isValid(cid)) return false;
    const charge = await this.chargeModel.findById(cid).exec();
    if (!charge) return false;
    const payableStatuses = [
      VendorNotificationChargeStatusEnum.PENDING,
      VendorNotificationChargeStatusEnum.INVOICED,
      VendorNotificationChargeStatusEnum.OVERDUE,
    ];
    if (
      !payableStatuses.includes(
        charge.status as VendorNotificationChargeStatusEnum,
      ) ||
      Number(charge.smsTotalCad) <= 0
    ) {
      return false;
    }

    const storeId = String(charge.store);
    const store = await this.storeModel
      .findById(storeId)
      .select('name owner email')
      .populate('owner', 'email fullName')
      .lean()
      .exec();
    if (!store) return false;

    const owner = store.owner as unknown as
      | { _id?: Types.ObjectId; email?: string; fullName?: string }
      | Types.ObjectId
      | null;
    const ownerId =
      owner && typeof owner === 'object' && '_id' in owner
        ? String(owner._id)
        : String(owner ?? '');
    const ownerEmail =
      owner && typeof owner === 'object' && 'email' in owner
        ? String(owner.email ?? '').trim()
        : '';
    const ownerName =
      owner && typeof owner === 'object' && 'fullName' in owner
        ? String(owner.fullName ?? '').trim()
        : 'Bonjour';

    const amountCad = Number(charge.smsTotalCad) || 0;
    const unitAmount = Math.round(amountCad * 100);
    if (unitAmount < 50) {
      await this.chargeModel.updateOne(
        { _id: charge._id },
        { $set: { status: VendorNotificationChargeStatusEnum.WAIVED } },
      );
      return false;
    }

    const stripe = this.stripe();
    const currency = String(charge.currency ?? 'CAD').trim().toLowerCase() || 'cad';
    const meta: Record<string, string> = {
      kind: VENDOR_SMS_BILLING_CHECKOUT_KIND,
      storeId,
      billingMonth: charge.billingMonth,
      chargeId: cid,
      ownerId,
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency,
      client_reference_id: storeId,
      customer_email: ownerEmail || store.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `Wise Eat · Notifications SMS ${charge.billingMonth}`,
              description: `${charge.smsCount} SMS · ${store.name ?? 'Boutique'}`,
            },
          },
        },
      ],
      success_url: this.successUrl(),
      cancel_url: this.cancelUrl(),
      metadata: meta,
      payment_intent_data: {
        description: `Notifications SMS ${charge.billingMonth}`,
        metadata: meta,
        receipt_email: ownerEmail || undefined,
      },
    });

    if (!session.url) {
      throw new BadRequestException('stripe_missing_checkout_url');
    }

    const dueAt = new Date();
    dueAt.setUTCDate(dueAt.getUTCDate() + this.graceDays());

    await this.chargeModel.updateOne(
      { _id: charge._id },
      {
        $set: {
          status: VendorNotificationChargeStatusEnum.INVOICED,
          invoicedAt: new Date(),
          dueAt,
          stripeCheckoutSessionId: session.id,
          checkoutUrl: session.url,
          currency: currency.toUpperCase(),
        },
      },
    );

    if (ownerEmail) {
      await this.sendInvoiceEmail({
        to: ownerEmail,
        toName: ownerName,
        storeName: String(store.name ?? 'Boutique'),
        billingMonth: charge.billingMonth,
        smsCount: charge.smsCount,
        amountCad,
        paymentUrl: session.url,
        dueAt,
      });
    }

    return true;
  }

  async fulfillFromCheckoutSession(session: {
    id: string;
    metadata?: Record<string, string | null | undefined> | null;
    amount_total?: number | null;
    payment_status?: string | null;
    status?: string | null;
    payment_intent?: string | { id?: string | null } | null;
  }): Promise<boolean> {
    if (session.metadata?.kind !== VENDOR_SMS_BILLING_CHECKOUT_KIND) {
      return false;
    }
    const isPaid =
      session.payment_status === 'paid' || session.status === 'complete';
    if (!isPaid) return true;

    const chargeId = String(session.metadata?.chargeId ?? '').trim();
    const storeId = String(session.metadata?.storeId ?? '').trim();
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    const filter = chargeId && Types.ObjectId.isValid(chargeId)
      ? { _id: new Types.ObjectId(chargeId) }
      : { stripeCheckoutSessionId: session.id };

    const charge = await this.chargeModel.findOne(filter).exec();
    if (!charge) {
      this.logger.warn(`SMS billing webhook: charge not found session=${session.id}`);
      return true;
    }

    if (charge.status === VendorNotificationChargeStatusEnum.PAID) {
      return true;
    }

    await this.chargeModel.updateOne(
      { _id: charge._id },
      {
        $set: {
          status: VendorNotificationChargeStatusEnum.PAID,
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntentId,
          stripeCheckoutSessionId: session.id,
        },
      },
    );

    const sid = storeId || String(charge.store);
    if (Types.ObjectId.isValid(sid)) {
      await this.prefs.resumeSmsBilling(sid);
    }

    this.logger.log(
      `SMS billing paid store=${sid} month=${charge.billingMonth} session=${session.id}`,
    );
    return true;
  }

  async processOverdueCharges(): Promise<{ suspended: number }> {
    const now = new Date();
    const overdue = await this.chargeModel
      .find({
        status: VendorNotificationChargeStatusEnum.INVOICED,
        dueAt: { $lt: now },
        smsTotalCad: { $gt: 0 },
      })
      .lean()
      .exec();

    let suspended = 0;
    for (const row of overdue) {
      const storeId = String(row.store);
      await this.chargeModel.updateOne(
        { _id: row._id },
        { $set: { status: VendorNotificationChargeStatusEnum.OVERDUE } },
      );
      await this.prefs.suspendSmsBilling(
        storeId,
        `Facture SMS ${row.billingMonth} impayée`,
      );
      suspended += 1;
      this.logger.warn(
        `SMS billing overdue — SMS disabled store=${storeId} month=${row.billingMonth}`,
      );
    }
    return { suspended };
  }

  async getPayLinkForStore(
    storeId: string,
    billingMonth?: string,
  ): Promise<{ url: string; billingMonth: string; amountCad: number }> {
    const sid = storeId.trim();
    if (!Types.ObjectId.isValid(sid)) {
      throw new BadRequestException('invalid_store_id');
    }
    const filter: Record<string, unknown> = {
      store: new Types.ObjectId(sid),
      smsTotalCad: { $gt: 0 },
      status: {
        $in: [
          VendorNotificationChargeStatusEnum.PENDING,
          VendorNotificationChargeStatusEnum.INVOICED,
          VendorNotificationChargeStatusEnum.OVERDUE,
        ],
      },
    };
    if (billingMonth?.trim()) {
      filter.billingMonth = billingMonth.trim();
    }
    const charge = await this.chargeModel
      .findOne(filter)
      .sort({ billingMonth: -1 })
      .exec();
    if (!charge) {
      throw new NotFoundException('sms_billing_charge_not_found');
    }

    if (
      charge.checkoutUrl &&
      (charge.status === VendorNotificationChargeStatusEnum.INVOICED ||
        charge.status === VendorNotificationChargeStatusEnum.OVERDUE)
    ) {
      return {
        url: charge.checkoutUrl,
        billingMonth: charge.billingMonth,
        amountCad: charge.smsTotalCad,
      };
    }

    await this.issueCheckoutForCharge(String(charge._id));
    const refreshed = await this.chargeModel.findById(charge._id).lean().exec();
    if (!refreshed?.checkoutUrl) {
      throw new BadRequestException('sms_billing_checkout_unavailable');
    }
    return {
      url: refreshed.checkoutUrl,
      billingMonth: refreshed.billingMonth,
      amountCad: refreshed.smsTotalCad,
    };
  }

  async confirmCheckoutSession(
    userId: string,
    sessionId: string,
  ): Promise<{ ok: true; billingMonth: string; amountCad: number }> {
    const sid = sessionId.trim();
    if (!sid) throw new BadRequestException('missing_session_id');
    const stripe = this.stripe();
    const session = await stripe.checkout.sessions.retrieve(sid);
    if (session.metadata?.kind !== VENDOR_SMS_BILLING_CHECKOUT_KIND) {
      throw new BadRequestException('invalid_checkout_kind');
    }
    const ownerId = String(session.metadata?.ownerId ?? '').trim();
    if (ownerId && ownerId !== String(userId)) {
      throw new BadRequestException('checkout_user_mismatch');
    }
    await this.fulfillFromCheckoutSession(session);
    const charge = await this.chargeModel
      .findOne({ stripeCheckoutSessionId: sid })
      .lean()
      .exec();
    return {
      ok: true,
      billingMonth: charge?.billingMonth ?? '',
      amountCad: Number(charge?.smsTotalCad ?? 0),
    };
  }

  private async sendInvoiceEmail(args: {
    to: string;
    toName: string;
    storeName: string;
    billingMonth: string;
    smsCount: number;
    amountCad: number;
    paymentUrl: string;
    dueAt: Date;
  }): Promise<void> {
    const appName =
      this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const dueStr = args.dueAt.toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const body = `Votre facture SMS pour ${args.storeName} (${args.billingMonth}) : ${args.smsCount} SMS pour ${args.amountCad.toFixed(2)} $. Payez avant le ${dueStr} pour conserver les notifications SMS. Stripe vous enverra un reçu après paiement.`;
    const html = [
      this.emailTpl.heading('Facture notifications SMS'),
      this.emailTpl.paragraph(`Bonjour <strong>${this.emailTpl.escapeHtml(args.toName)}</strong>,`),
      this.emailTpl.paragraph(this.emailTpl.escapeHtml(body)),
      this.emailTpl.paragraph(
        `<a href="${this.emailTpl.escapeHtml(args.paymentUrl)}" style="display:inline-block;padding:12px 20px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Payer avec Stripe</a>`,
      ),
      this.emailTpl.muted(
        'Sans paiement avant la date limite, les notifications SMS seront désactivées pour votre boutique.',
      ),
    ].join('\n');
    const text = [
      `Bonjour ${args.toName},`,
      '',
      body,
      '',
      `Payer : ${args.paymentUrl}`,
      '',
      `— L'équipe ${appName}`,
    ].join('\n');

    try {
      await this.mailer.sendSimple({
        to: args.to,
        toName: args.toName,
        subject: `${appName} — Facture SMS ${args.billingMonth}`,
        html,
        text,
      });
    } catch (e) {
      this.logger.warn(
        `SMS billing invoice email failed ${args.to}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
