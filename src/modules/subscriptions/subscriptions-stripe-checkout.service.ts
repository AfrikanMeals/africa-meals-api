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
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import { SubscribeVendorDto } from './dto/subscription-plan.dto';
import { isFreeSubscriptionPlan } from './subscription-plan.util';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionPlanOrderCommissionService } from './subscription-plan-order-commission.service';
import { SubscriptionAdCashService } from './subscription-ad-cash.service';
import { VendorSubscriptionEmailService } from './vendor-subscription-email.service';
import { resolveVendorCheckoutStoreId } from './subscription-vendor-store.util';

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

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

type PlanSwitchDraft = {
  storeId: Types.ObjectId;
  plan: Record<string, unknown> & { _id: Types.ObjectId; name: string };
  period: VendorSubscriptionBillingPeriod;
  pricePaid: number;
  currency: string;
  unitAmountCents: number;
  planName: string;
};

@Injectable()
export class SubscriptionsStripeCheckoutService {
  private readonly logger = new Logger(SubscriptionsStripeCheckoutService.name);

  @Inject(ConfigService)
  private readonly config: ConfigService;

  @InjectModel(SubscriptionPlanModel.name)
  private readonly planModel: Model<SubscriptionPlanModel>;

  @InjectModel(VendorSubscriptionModel.name)
  private readonly vendorSubModel: Model<VendorSubscriptionModel>;

  constructor(
    private readonly subscriptionEmails: VendorSubscriptionEmailService,
    private readonly subscriptions: SubscriptionsService,
    private readonly planRegionalFees: SubscriptionPlanOrderCommissionService,
    private readonly subscriptionAdCash: SubscriptionAdCashService,
  ) {}

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
    const adminBase =
      this.config.get<string>('FRONTEND_URL')?.trim() ||
      this.config.get<string>('ADMIN_APP_URL')?.trim() ||
      this.config.get<string>('CLIENT_APP_URL')?.trim() ||
      'http://localhost:3000';
    const adminSubscriptionUrl = `${adminBase.replace(
      /\/$/,
      '',
    )}/settings/subscription`;
    const configured =
      this.config.get<string>('STRIPE_SUBSCRIPTION_SUCCESS_URL')?.trim() || '';
    const raw = configured || adminSubscriptionUrl;
    if (raw.startsWith('wise-eat://')) {
      const publicWeb = this.config
        .get<string>('PUBLIC_WEB_URL')
        ?.trim()
        .replace(/\/$/, '');
      if (publicWeb) {
        return `${publicWeb}/checkout-success?session_id={CHECKOUT_SESSION_ID}&mobile_return=vendor_subscription`;
      }
      return `${server}/api/billing/stripe/subscription-return?session_id={CHECKOUT_SESSION_ID}`;
    }
    return raw.includes('{CHECKOUT_SESSION_ID}')
      ? raw
      : `${raw}${
          raw.includes('?') ? '&' : '?'
        }session_id={CHECKOUT_SESSION_ID}`;
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

  private async draftVendorPlanSwitch(
    user: UserModel,
    dto: SubscribeVendorDto,
  ): Promise<PlanSwitchDraft> {
    const accessibleStores =
      await this.subscriptions.resolveAccessibleStoreIds(user);
    if (!accessibleStores.length) {
      throw new BadRequestException('vendor_only');
    }

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

    const storeId = resolveVendorCheckoutStoreId(
      user,
      dto.storeId,
      (plan as { storeId?: unknown }).storeId,
      accessibleStores,
    );

    const now = new Date();
    const activeExisting = await this.vendorSubModel
      .findOne({
        store: storeId,
        status: 'ACTIVE',
        endsAt: { $gt: now },
      })
      .lean()
      .exec();
    if (activeExisting) {
      const isTrialOnly =
        (activeExisting as { isTrial?: boolean }).isTrial === true;
      if (isTrialOnly) {
        await this.vendorSubModel
          .updateOne(
            { _id: activeExisting._id },
            {
              $set: {
                status: 'EXPIRED' as VendorSubscriptionStatus,
                endsAt: now,
              },
            },
          )
          .exec();
      } else {
        const samePlan = String(activeExisting.plan) === String(dto.planId);
        const samePeriod = activeExisting.billingPeriod === period;
        if (samePlan && samePeriod) {
          throw new BadRequestException('subscription_unchanged');
        }
      }
    }

    await this.vendorSubModel.deleteMany({
      store: storeId,
      status: 'PENDING_PAYMENT',
    });

    const planDoc = plan as Record<string, unknown> & {
      _id: Types.ObjectId;
      name: string;
    };
    const pricing = await this.planRegionalFees.resolvePlanPricingForStore(
      String(storeId),
      planDoc,
    );
    const pricePaid =
      period === 'MONTHLY' ? pricing.priceMonthly : pricing.priceYearly;
    const currency = pricing.currency;
    const unitAmountCents = dollarsToCents(pricePaid);
    const planName = String(planDoc.name ?? 'Abonnement');

    return {
      storeId,
      plan: planDoc as PlanSwitchDraft['plan'],
      period,
      pricePaid,
      currency,
      unitAmountCents,
      planName,
    };
  }

  /** Active une formule gratuite sans passer par Stripe. */
  async activateVendorFreePlan(
    user: UserModel,
    dto: SubscribeVendorDto,
  ): Promise<{ activated: true; subscriptionId: string }> {
    const draft = await this.draftVendorPlanSwitch(user, dto);
    return this.finalizeFreePlanFromDraft(user, draft);
  }

  private async finalizeFreePlanFromDraft(
    user: UserModel,
    draft: PlanSwitchDraft,
  ): Promise<{ activated: true; subscriptionId: string }> {
    if (draft.pricePaid > 0 || draft.unitAmountCents > 0) {
      throw new BadRequestException({
        message: 'amount_below_stripe_minimum',
        pricePaid: draft.pricePaid,
      });
    }

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setFullYear(endsAt.getFullYear() + 50);

    const created = await this.vendorSubModel.create({
      store: draft.storeId,
      owner: user._id,
      plan: draft.plan._id,
      billingPeriod: draft.period,
      status: 'ACTIVE' as VendorSubscriptionStatus,
      startsAt: now,
      endsAt,
      pricePaid: 0,
      currency: draft.currency,
      planName: draft.planName,
      isTrial: false,
      trialEndsAt: null,
      trialRemindersSent: [],
    });

    await this.vendorSubModel
      .updateMany(
        {
          store: draft.storeId,
          status: 'ACTIVE',
          _id: { $ne: created._id },
        },
        {
          $set: {
            status: 'EXPIRED' as VendorSubscriptionStatus,
            endsAt: now,
          },
        },
      )
      .exec();

    await this.subscriptions.applyAdLimitsDowngradeForStore(
      String(draft.storeId),
    );

    void this.subscriptionAdCash
      .applyForActivatedSubscription(String(created._id))
      .catch((e) => {
        this.logger.warn(
          `Plan Ad Cash gift failed sub=${String(created._id)}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });

    return {
      activated: true,
      subscriptionId: String(created._id),
    };
  }

  private async createPendingFromDraft(
    user: UserModel,
    draft: PlanSwitchDraft,
  ): Promise<PendingSubscriptionContext> {
    const now = new Date();
    const pending = await this.vendorSubModel.create({
      store: draft.storeId,
      owner: user._id,
      plan: draft.plan._id,
      billingPeriod: draft.period,
      status: 'PENDING_PAYMENT' as VendorSubscriptionStatus,
      startsAt: now,
      endsAt: new Date(now),
      pricePaid: draft.pricePaid,
      currency: draft.currency,
      planName: draft.planName,
    });

    const pendingId = String(pending._id);
    const meta: Record<string, string> = {
      kind: METADATA_KIND,
      pendingSubId: pendingId,
      uid: String(user.id ?? user._id),
      planId: String(draft.plan._id),
      storeId: String(draft.storeId),
      billingPeriod: draft.period,
    };

    return {
      pendingId,
      planName: draft.planName,
      period: draft.period,
      pricePaid: draft.pricePaid,
      currency: draft.currency,
      unitAmountCents: draft.unitAmountCents,
      meta,
    };
  }

  private isDraftFreePlan(draft: PlanSwitchDraft): boolean {
    return isFreeSubscriptionPlan({
      name: draft.planName,
      priceMonthly: Number(draft.plan.priceMonthly ?? 0),
      priceYearly: Number(draft.plan.priceYearly ?? 0),
    });
  }

  private async preparePendingSubscription(
    user: UserModel,
    dto: SubscribeVendorDto,
  ): Promise<PendingSubscriptionContext> {
    const draft = await this.draftVendorPlanSwitch(user, dto);
    if (this.isDraftFreePlan(draft)) {
      throw new BadRequestException('free_plan_use_checkout_activation');
    }
    if (draft.unitAmountCents < 50) {
      throw new BadRequestException({
        message: 'amount_below_stripe_minimum',
        pricePaid: draft.pricePaid,
      });
    }

    return this.createPendingFromDraft(user, draft);
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
      opts.amountCents != null ? opts.amountCents / 100 : existing.pricePaid;

    const patch: Record<string, unknown> = {
      status: 'ACTIVE' as VendorSubscriptionStatus,
      startsAt: now,
      endsAt,
      pricePaid,
      isTrial: false,
      trialEndsAt: null,
      trialRemindersSent: [],
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

    const nowExpire = new Date();
    await this.vendorSubModel
      .updateMany(
        {
          store: existing.store,
          status: 'ACTIVE',
          _id: { $ne: existing._id },
        },
        {
          $set: {
            status: 'EXPIRED' as VendorSubscriptionStatus,
            endsAt: nowExpire,
          },
        },
      )
      .exec();

    const refreshed = await this.vendorSubModel.findById(existing._id).lean().exec();
    if (refreshed) {
      const ctx = await this.subscriptionEmails.buildContextFromSubscription(
        refreshed as Record<string, unknown>,
      );
      if (ctx) {
        void this.subscriptionEmails.notifyPlanRenewal(ctx).catch((e) => {
          this.logger.warn(
            `Renewal email failed sub=${ctx.subscriptionId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        });
      }
    }

    void this.subscriptionAdCash
      .applyForActivatedSubscription(String(existing._id))
      .catch((e) => {
        this.logger.warn(
          `Plan Ad Cash gift failed sub=${String(existing._id)}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });

    return {
      activated: true,
      subscriptionId: String(existing._id),
    };
  }

  /** PaymentIntent + Payment Sheet (recommandé mobile). Sans frais plateforme. */
  async createPaymentIntent(
    user: UserModel,
    dto: SubscribeVendorDto,
  ): Promise<
    | { activated: true; subscriptionId: string }
    | { clientSecret: string; paymentIntentId: string }
  > {
    const draft = await this.draftVendorPlanSwitch(user, dto);
    if (this.isDraftFreePlan(draft)) {
      return this.finalizeFreePlanFromDraft(user, draft);
    }
    if (draft.unitAmountCents < 50) {
      throw new BadRequestException({
        message: 'amount_below_stripe_minimum',
        pricePaid: draft.pricePaid,
      });
    }

    const ctx = await this.createPendingFromDraft(user, draft);
    const stripe = this.stripe();
    const pi = await stripe.paymentIntents.create({
      amount: ctx.unitAmountCents,
      currency: ctx.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: ctx.meta,
      receipt_email: user.email || undefined,
      description: `Wise Eat · Abonnement ${ctx.planName}`,
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
      this.logger.warn(`Subscription PI ${pi.id}: status=${pi.status}`);
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
    const accessibleStores =
      await this.subscriptions.resolveAccessibleStoreIds(user);
    if (!accessibleStores.length) {
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
  ): Promise<
    | { activated: true; subscriptionId: string }
    | { url: string; sessionId: string }
  > {
    const draft = await this.draftVendorPlanSwitch(user, dto);
    if (this.isDraftFreePlan(draft)) {
      return this.finalizeFreePlanFromDraft(user, draft);
    }
    if (draft.unitAmountCents < 50) {
      throw new BadRequestException({
        message: 'amount_below_stripe_minimum',
        pricePaid: draft.pricePaid,
      });
    }

    const ctx = await this.createPendingFromDraft(user, draft);
    const periodLabel = ctx.period === 'YEARLY' ? 'annuel' : 'mensuel';
    const stripe = this.stripe();
    const pmcId = this.config
      .get<string>('STRIPE_PAYMENT_METHOD_CONFIGURATION')
      ?.trim();
    const session = pmcId
      ? await stripe.checkout.sessions.create({
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
                  name: `Wise Eat · ${ctx.planName}`,
                  description: `Abonnement vendeur (${periodLabel}) — sans frais plateforme`,
                },
              },
            },
          ],
          success_url: this.subscriptionSuccessUrl(),
          cancel_url: this.subscriptionCancelUrl(),
          metadata: ctx.meta,
          payment_intent_data: {
            description: `Wise Eat · Abonnement ${ctx.planName}`,
            metadata: ctx.meta,
          },
          payment_method_configuration: pmcId,
        })
      : await stripe.checkout.sessions.create({
          mode: 'payment',
          currency: ctx.currency.toLowerCase(),
          // Apple Pay est exposé via `card` sur Stripe Checkout
          // quand les prérequis Stripe/Apple sont satisfaits.
          payment_method_types: ['card'],
          client_reference_id: String(user.id ?? user._id),
          customer_email: user.email || undefined,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: ctx.currency.toLowerCase(),
                unit_amount: ctx.unitAmountCents,
                product_data: {
                  name: `Wise Eat · ${ctx.planName}`,
                  description: `Abonnement vendeur (${periodLabel}) — sans frais plateforme`,
                },
              },
            },
          ],
          success_url: this.subscriptionSuccessUrl(),
          cancel_url: this.subscriptionCancelUrl(),
          metadata: ctx.meta,
          payment_intent_data: {
            description: `Wise Eat · Abonnement ${ctx.planName}`,
            metadata: ctx.meta,
          },
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

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
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
      currency: session.currency != null ? String(session.currency) : undefined,
      stripeCheckoutSessionId: session.id,
    });
  }

  async confirmCheckoutForUser(
    user: UserModel,
    sessionId: string,
  ): Promise<{ activated: boolean }> {
    const accessibleStores =
      await this.subscriptions.resolveAccessibleStoreIds(user);
    if (!accessibleStores.length) {
      throw new BadRequestException('vendor_only');
    }
    const sid = sessionId?.trim();
    if (!sid) {
      throw new BadRequestException('missing_session_id');
    }
    return this.fulfillFromCheckoutSessionId(sid, String(user.id ?? user._id));
  }

  async confirmCheckoutForUserBySessionId(
    userId: string,
    sessionId: string,
  ): Promise<{ activated: boolean }> {
    const sid = sessionId?.trim();
    const uid = userId?.trim();
    if (!sid || !uid) {
      throw new BadRequestException('missing_session_or_user');
    }
    return this.fulfillFromCheckoutSessionId(sid, uid);
  }
}
