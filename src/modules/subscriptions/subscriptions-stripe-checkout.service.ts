import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SubscriptionPlanModel } from '@schemas/subscription-plan.schema';
import {
  VendorSubscriptionBillingPeriod,
  VendorSubscriptionModel,
  VendorSubscriptionStatus,
} from '@schemas/vendor-subscription.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import { SubscribeVendorDto } from './dto/subscription-plan.dto';

type StripeClient = InstanceType<typeof Stripe>;

const METADATA_KIND = 'vendor_subscription';

type PendingSubscriptionContext = {
  pendingId: string;
  planName: string;
  period: VendorSubscriptionBillingPeriod;
  pricePaid: number;
  currency: string;
  unitAmountCents: number;
  meta: Record<string, string>;
};

function vendorStoreObjectIds(user: UserModel): Types.ObjectId[] {
  const rawStores = user.stores || [];
  const ids: Types.ObjectId[] = [];
  for (const s of rawStores) {
    if (typeof s === 'object' && s !== null && '_id' in s) {
      const id = (s as { _id: unknown })._id;
      ids.push(
        id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id)),
      );
    } else if (s) {
      ids.push(new Types.ObjectId(String(s)));
    }
  }
  return ids;
}

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

@Injectable()
export class SubscriptionsStripeCheckoutService {
  private readonly logger = new Logger(SubscriptionsStripeCheckoutService.name);

  @Inject(ConfigService)
  private readonly config: ConfigService;

  @InjectModel(SubscriptionPlanModel.name)
  private readonly planModel: Model<SubscriptionPlanModel>;

  @InjectModel(VendorSubscriptionModel.name)
  private readonly vendorSubModel: Model<VendorSubscriptionModel>;

  private stripe(): StripeClient {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new BadRequestException('stripe_not_configured');
    }
    return new Stripe(key);
  }

  private subscriptionSuccessUrl(): string {
    const server =
      this.config.get<string>('SERVER_URL')?.replace(/\/$/, '') ??
      'http://localhost:9000';
    const configured =
      this.config.get<string>('STRIPE_SUBSCRIPTION_SUCCESS_URL')?.trim() ||
      '';
    const raw =
      configured ||
      `${server}/api/billing/stripe/subscription-return?session_id={CHECKOUT_SESSION_ID}`;
    if (raw.startsWith('africameals://')) {
      return `${server}/api/billing/stripe/subscription-return?session_id={CHECKOUT_SESSION_ID}`;
    }
    return raw.includes('{CHECKOUT_SESSION_ID}')
      ? raw
      : `${raw}${raw.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
  }

  private subscriptionCancelUrl(): string {
    const server =
      this.config.get<string>('SERVER_URL')?.replace(/\/$/, '') ??
      'http://localhost:9000';
    return (
      this.config.get<string>('STRIPE_SUBSCRIPTION_CANCEL_URL')?.trim() ||
      this.config.get<string>('STRIPE_CHECKOUT_CANCEL_URL')?.trim() ||
      `${server}/api/billing/stripe/payment-cancel`
    );
  }

  private async preparePendingSubscription(
    user: UserModel,
    dto: SubscribeVendorDto,
  ): Promise<PendingSubscriptionContext> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new BadRequestException('vendor_only');
    }
    const storeIds = vendorStoreObjectIds(user);
    if (!storeIds.length) {
      throw new BadRequestException('no_store');
    }
    const storeId = storeIds[0];

    if (!Types.ObjectId.isValid(dto.planId)) {
      throw new NotFoundException('plan_not_found');
    }
    const period = dto.billingPeriod as VendorSubscriptionBillingPeriod;
    if (period !== 'MONTHLY' && period !== 'YEARLY') {
      throw new BadRequestException('invalid_billing_period');
    }

    const plan = await this.planModel
      .findOne({ _id: dto.planId, active: true })
      .lean()
      .exec();
    if (!plan) throw new NotFoundException('plan_not_found');

    const now = new Date();
    const activeExisting = await this.vendorSubModel
      .findOne({
        store: storeId,
        status: 'ACTIVE',
        endsAt: { $gt: now },
      })
      .exec();
    if (activeExisting) {
      throw new BadRequestException('subscription_already_active');
    }

    await this.vendorSubModel.deleteMany({
      store: storeId,
      status: 'PENDING_PAYMENT',
    });

    const pricePaid =
      period === 'MONTHLY'
        ? Number((plan as { priceMonthly: number }).priceMonthly)
        : Number((plan as { priceYearly: number }).priceYearly);
    const currency = String((plan as { currency?: string }).currency ?? 'CAD')
      .trim()
      .toUpperCase();
    const unitAmountCents = dollarsToCents(pricePaid);
    if (unitAmountCents < 50) {
      throw new BadRequestException({
        message: 'amount_below_stripe_minimum',
        pricePaid,
      });
    }

    const pending = await this.vendorSubModel.create({
      store: storeId,
      owner: user._id,
      plan: plan._id,
      billingPeriod: period,
      status: 'PENDING_PAYMENT' as VendorSubscriptionStatus,
      startsAt: now,
      endsAt: new Date(now),
      pricePaid,
      currency,
      planName: String((plan as { name: string }).name ?? ''),
    });

    const pendingId = String(pending._id);
    const planName = String((plan as { name: string }).name ?? 'Abonnement');
    const meta: Record<string, string> = {
      kind: METADATA_KIND,
      pendingSubId: pendingId,
      uid: String(user.id ?? user._id),
      planId: String(plan._id),
      storeId: String(storeId),
      billingPeriod: period,
    };

    return {
      pendingId,
      planName,
      period,
      pricePaid,
      currency,
      unitAmountCents,
      meta,
    };
  }

  private async activatePendingSubscription(
    pendingSubId: string,
    opts: {
      expectedOwnerId?: string;
      metaUid?: string;
      amountCents?: number;
      currency?: string;
      stripeCheckoutSessionId?: string;
      stripePaymentIntentId?: string;
    },
  ): Promise<{ activated: boolean; subscriptionId?: string }> {
    const uid = opts.metaUid?.trim();
    if (opts.expectedOwnerId && uid && uid !== opts.expectedOwnerId) {
      throw new BadRequestException('subscription_payment_owner_mismatch');
    }

    if (!Types.ObjectId.isValid(pendingSubId)) {
      return { activated: false };
    }

    const existing = await this.vendorSubModel.findById(pendingSubId).exec();
    if (!existing) {
      return { activated: false };
    }

    if (existing.status === 'ACTIVE') {
      return {
        activated: true,
        subscriptionId: String(existing._id),
      };
    }

    if (existing.status !== 'PENDING_PAYMENT') {
      return { activated: false };
    }

    const period = existing.billingPeriod;
    const now = new Date();
    const endsAt = new Date(now);
    if (period === 'MONTHLY') {
      endsAt.setMonth(endsAt.getMonth() + 1);
    } else {
      endsAt.setFullYear(endsAt.getFullYear() + 1);
    }

    const pricePaid =
      opts.amountCents != null
        ? opts.amountCents / 100
        : existing.pricePaid;

    const patch: Record<string, unknown> = {
      status: 'ACTIVE' as VendorSubscriptionStatus,
      startsAt: now,
      endsAt,
      pricePaid,
    };
    if (opts.currency) {
      patch.currency = opts.currency.toUpperCase();
    }
    if (opts.stripeCheckoutSessionId) {
      patch.stripeCheckoutSessionId = opts.stripeCheckoutSessionId;
    }
    if (opts.stripePaymentIntentId) {
      patch.stripePaymentIntentId = opts.stripePaymentIntentId;
    }

    await this.vendorSubModel
      .updateOne({ _id: existing._id }, { $set: patch })
      .exec();

    return {
      activated: true,
      subscriptionId: String(existing._id),
    };
  }

  /** PaymentIntent + Payment Sheet (recommandé mobile). Sans frais plateforme. */
  async createPaymentIntent(
    user: UserModel,
    dto: SubscribeVendorDto,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const ctx = await this.preparePendingSubscription(user, dto);
    const stripe = this.stripe();
    const pi = await stripe.paymentIntents.create({
      amount: ctx.unitAmountCents,
      currency: ctx.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: ctx.meta,
      receipt_email: user.email || undefined,
      description: `Afrika Meals · Abonnement ${ctx.planName}`,
    });

    if (!pi.client_secret) {
      await this.vendorSubModel.deleteOne({ _id: ctx.pendingId }).exec();
      throw new BadRequestException('stripe_missing_payment_intent_secret');
    }

    await this.vendorSubModel
      .updateOne(
        { _id: ctx.pendingId },
        { $set: { stripePaymentIntentId: pi.id } },
      )
      .exec();

    return {
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
    };
  }

  async fulfillFromPaymentIntentObject(
    pi: {
      id: string;
      status?: string | null;
      metadata?: Record<string, string | null | undefined> | null;
      amount?: number | null;
      amount_received?: number | null;
      currency?: string | null;
    },
    expectedOwnerId?: string,
  ): Promise<{ activated: boolean; subscriptionId?: string }> {
    if (pi.metadata?.kind !== METADATA_KIND) {
      return { activated: false };
    }
    if (pi.status != null && pi.status !== 'succeeded') {
      this.logger.warn(
        `Subscription PI ${pi.id}: status=${pi.status}`,
      );
      return { activated: false };
    }

    const pendingSubId = pi.metadata?.pendingSubId?.trim();
    if (!pendingSubId) {
      this.logger.warn(`Subscription PI ${pi.id}: missing pendingSubId`);
      return { activated: false };
    }

    const amountCents =
      pi.amount_received != null
        ? pi.amount_received
        : pi.amount != null
          ? pi.amount
          : undefined;

    return this.activatePendingSubscription(pendingSubId, {
      expectedOwnerId,
      metaUid: pi.metadata?.uid?.trim(),
      amountCents,
      currency: pi.currency != null ? String(pi.currency) : undefined,
      stripePaymentIntentId: pi.id,
    });
  }

  async syncPaymentIntentForUser(
    user: UserModel,
    paymentIntentId: string,
  ): Promise<{ activated: boolean; subscriptionId?: string }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new BadRequestException('vendor_only');
    }
    const id = paymentIntentId?.trim();
    if (!id?.startsWith('pi_')) {
      throw new BadRequestException('invalid_payment_intent_id');
    }

    const stripe = this.stripe();
    const pi = await stripe.paymentIntents.retrieve(id);
    if (pi.status !== 'succeeded') {
      throw new BadRequestException({
        message: 'payment_intent_not_succeeded',
        status: pi.status,
      });
    }
    if (pi.metadata?.kind !== METADATA_KIND) {
      throw new BadRequestException('not_subscription_payment_intent');
    }
    if (String(pi.metadata?.uid ?? '') !== String(user.id ?? user._id)) {
      throw new ForbiddenException('payment_intent_user_mismatch');
    }

    const result = await this.fulfillFromPaymentIntentObject(
      pi,
      String(user.id ?? user._id),
    );
    if (!result.activated) {
      throw new BadRequestException('subscription_activation_failed');
    }
    return result;
  }

  /** Checkout hébergé (secours navigateur). */
  async createCheckoutSession(
    user: UserModel,
    dto: SubscribeVendorDto,
  ): Promise<{ url: string; sessionId: string }> {
    const ctx = await this.preparePendingSubscription(user, dto);
    const periodLabel = ctx.period === 'YEARLY' ? 'annuel' : 'mensuel';
    const stripe = this.stripe();
    const pmcId = this.config
      .get<string>('STRIPE_PAYMENT_METHOD_CONFIGURATION')
      ?.trim();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: ctx.currency.toLowerCase(),
      client_reference_id: String(user.id ?? user._id),
      customer_email: user.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: ctx.currency.toLowerCase(),
            unit_amount: ctx.unitAmountCents,
            product_data: {
              name: `Afrika Meals · ${ctx.planName}`,
              description: `Abonnement vendeur (${periodLabel}) — sans frais plateforme`,
            },
          },
        },
      ],
      success_url: this.subscriptionSuccessUrl(),
      cancel_url: this.subscriptionCancelUrl(),
      metadata: ctx.meta,
      payment_intent_data: {
        description: `Afrika Meals · Abonnement ${ctx.planName}`,
        metadata: ctx.meta,
      },
      ...(pmcId ? { payment_method_configuration: pmcId } : {}),
    });

    const url = session.url;
    if (!url) {
      await this.vendorSubModel.deleteOne({ _id: ctx.pendingId }).exec();
      throw new BadRequestException('stripe_missing_checkout_url');
    }

    await this.vendorSubModel
      .updateOne(
        { _id: ctx.pendingId },
        { $set: { stripeCheckoutSessionId: session.id } },
      )
      .exec();

    return { url, sessionId: session.id };
  }

  async fulfillFromCheckoutSessionId(
    sessionId: string,
    expectedOwnerId?: string,
  ): Promise<{ activated: boolean; subscriptionId?: string }> {
    const stripe = this.stripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return this.fulfillFromCheckoutSessionObject(session, expectedOwnerId);
  }

  async fulfillFromCheckoutSessionObject(
    session: {
      id: string;
      payment_status?: string | null;
      status?: string | null;
      metadata?: Record<string, string | null | undefined> | null;
      amount_total?: number | null;
      currency?: string | null;
    },
    expectedOwnerId?: string,
  ): Promise<{ activated: boolean; subscriptionId?: string }> {
    if (session.metadata?.kind !== METADATA_KIND) {
      return { activated: false };
    }

    if (
      session.payment_status !== 'paid' &&
      session.status !== 'complete'
    ) {
      this.logger.warn(
        `Subscription checkout ${session.id}: not paid (status=${session.status}, payment=${session.payment_status})`,
      );
      return { activated: false };
    }

    const pendingSubId = session.metadata?.pendingSubId?.trim();
    if (!pendingSubId) {
      this.logger.warn(
        `Subscription checkout ${session.id}: missing pendingSubId`,
      );
      return { activated: false };
    }

    const amountCents =
      session.amount_total != null ? session.amount_total : undefined;

    return this.activatePendingSubscription(pendingSubId, {
      expectedOwnerId,
      metaUid: session.metadata?.uid?.trim(),
      amountCents,
      currency:
        session.currency != null ? String(session.currency) : undefined,
      stripeCheckoutSessionId: session.id,
    });
  }

  async confirmCheckoutForUser(
    user: UserModel,
    sessionId: string,
  ): Promise<{ activated: boolean }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new BadRequestException('vendor_only');
    }
    const sid = sessionId?.trim();
    if (!sid) {
      throw new BadRequestException('missing_session_id');
    }
    return this.fulfillFromCheckoutSessionId(sid, String(user.id ?? user._id));
  }
}
