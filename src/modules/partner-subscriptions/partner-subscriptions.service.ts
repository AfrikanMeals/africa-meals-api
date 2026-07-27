import { NotificationsService } from '@modules/notifications/notifications.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { PartnerOnboardingEmailService } from '@modules/vendor-emails/partner-onboarding-email.service';
import { resolvePortalAppBaseUrl } from '@common/portal/portal-app-base-url.util';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PartnerSubscriptionPlanModel } from '@schemas/partner-subscription-plan.schema';
import {
  PartnerSubscriptionBillingPeriod,
  PartnerSubscriptionModel,
} from '@schemas/partner-subscription.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import {
  StartPartnerTrialDto,
  SubscribePartnerDto,
} from './dto/partner-subscription-plan.dto';
import { mergePartnerSubscriptionAdminRow } from './partner-subscription-admin-list.util';
import {
  isFreeSubscriptionPlan,
  pickDefaultPartnerFreePlan,
} from './partner-free-plan.util';
import {
  isPartnerSubscriptionPaymentIntentKind,
  PARTNER_SUBSCRIPTION_STRIPE_KIND,
} from './partner-payment-intent.util';
import { pickPartnerPricingRegionCode } from './partner-pricing-region.util';
import {
  partnerPriceToStripeMinorUnits,
  partnerStripeMinimumMinorUnits,
} from './partner-stripe-amount.util';
import { PartnerSubscriptionPlansService } from './partner-subscription-plans.service';

type StripeClient = InstanceType<typeof Stripe>;

const METADATA_KIND = PARTNER_SUBSCRIPTION_STRIPE_KIND;

function mapSub(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    ownerId: String(doc.owner ?? ''),
    planId: String(doc.plan ?? ''),
    billingPeriod: String(doc.billingPeriod ?? 'MONTHLY'),
    status: String(doc.status ?? ''),
    startsAt: doc.startsAt,
    endsAt: doc.endsAt,
    pricePaid: Number(doc.pricePaid ?? 0),
    currency: String(doc.currency ?? 'CAD'),
    planName: String(doc.planName ?? ''),
    isTrial: doc.isTrial === true,
    trialEndsAt: doc.trialEndsAt ?? null,
    trialRemindersSent: Array.isArray(doc.trialRemindersSent)
      ? doc.trialRemindersSent.map((d) => Number(d))
      : [],
    isOffer: doc.isOffer === true,
    offerNote: String(doc.offerNote ?? ''),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class PartnerSubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(PartnerSubscriptionsService.name);

  constructor(
    @InjectModel(PartnerSubscriptionModel.name)
    private readonly subModel: Model<PartnerSubscriptionModel>,
    @InjectModel(PartnerSubscriptionPlanModel.name)
    private readonly planModel: Model<PartnerSubscriptionPlanModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly plans: PartnerSubscriptionPlansService,
    private readonly supportedCountries: SupportedCountriesService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly partnerEmails: PartnerOnboardingEmailService,
  ) {}

  /** Backfill FREE pour les comptes PARTNER sans abonnement actif. */
  async onModuleInit() {
    try {
      await this.ensureDefaultFreeForPartnersWithoutActiveSubscription();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`partner_default_free_backfill_failed: ${msg}`);
    }
  }

  private async findDefaultFreePlan(): Promise<Record<string, unknown> | null> {
    const rows = await this.planModel
      .find({ active: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();
    const candidates = (rows as Record<string, unknown>[]).map((row) => ({
      row,
      name: String(row.name ?? ''),
      priceMonthly: Number(row.priceMonthly ?? 0),
      priceYearly: Number(row.priceYearly ?? 0),
      active: row.active !== false,
    }));
    const picked = pickDefaultPartnerFreePlan(candidates);
    return picked?.row ?? null;
  }

  /**
   * Assigne le plan FREE par défaut si le Partner n’a pas d’abonnement ACTIVE
   * encore valide (parité `ensureStoreDefaultFreePlan` vendeur).
   */
  async ensurePartnerDefaultFreePlan(
    ownerId: string | Types.ObjectId,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(String(ownerId))) return;
    const oid = new Types.ObjectId(String(ownerId));
    const existing = await this.findActiveSubscriptionForOwner(String(oid));
    if (existing) return;

    const freePlan = await this.findDefaultFreePlan();
    if (!freePlan) {
      this.logger.warn(
        `Aucun plan FREE Partner disponible pour owner=${String(oid)}`,
      );
      return;
    }

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setFullYear(endsAt.getFullYear() + 50);
    const planName = String(freePlan.name ?? 'FREE');
    // Devise FREE : Pays d’utilisation profil > candidature.region.
    const ownerUser = await this.userModel
      .findById(oid)
      .select('appCountryCode')
      .lean()
      .exec();
    const operating = await this.plans.getPartnerOperatingRegionCode(oid);
    const pricingRegion = pickPartnerPricingRegionCode({
      appCountryCode: (ownerUser as { appCountryCode?: string } | null)
        ?.appCountryCode,
      partnerOperatingRegion: operating,
    });
    const pricing = this.plans.resolvePricingForRegion(freePlan, pricingRegion);
    await this.subModel.create({
      owner: oid,
      plan: freePlan._id as Types.ObjectId,
      billingPeriod: 'MONTHLY',
      status: 'ACTIVE',
      startsAt: now,
      endsAt,
      pricePaid: 0,
      currency: pricing.currency,
      planName,
      isTrial: false,
      trialEndsAt: null,
      trialRemindersSent: [],
    });
    this.logger.log(
      `partner_default_free_assigned owner=${String(oid)} plan=${planName}`,
    );
  }

  /** Backfill démarrage API — tous les users type PARTNER. */
  async ensureDefaultFreeForPartnersWithoutActiveSubscription(): Promise<void> {
    const partners = await this.userModel
      .find({ type: UserTypeEnum.PARTNER })
      .select('_id')
      .lean()
      .exec();
    for (const p of partners) {
      await this.ensurePartnerDefaultFreePlan(p._id as Types.ObjectId);
    }
  }

  /**
   * Active explicitement un plan FREE (sans Stripe) — remplace les ACTIVE
   * courants (changement de formule vers FREE).
   */
  async activateFreePlan(user: UserModel, planId?: string) {
    this.assertPartner(user);
    // Région Partner avant validation FREE (prix régionaux à 0).
    const pricingRegion = await this.plans.resolvePricingRegionForUser(user);
    let plan: Record<string, unknown> | null = null;
    if (planId?.trim()) {
      plan = (await this.plans.getPlanLean(planId.trim())) as Record<
        string,
        unknown
      > | null;
      if (!plan || plan.active === false) {
        throw new NotFoundException('partner_plan_not_found');
      }
      const pricingCheck = this.plans.resolvePricingForRegion(
        plan,
        pricingRegion,
      );
      if (
        !isFreeSubscriptionPlan({
          name: String(plan.name ?? ''),
          priceMonthly: pricingCheck.priceMonthly,
          priceYearly: pricingCheck.priceYearly,
        })
      ) {
        throw new BadRequestException('partner_plan_not_free');
      }
    } else {
      plan = await this.findDefaultFreePlan();
      if (!plan) throw new NotFoundException('partner_free_plan_not_found');
    }

    const ownerId = new Types.ObjectId(String(user._id));
    // 1. Clôturer les ACTIVE existants (y compris autre FREE / essai).
    await this.subModel
      .updateMany(
        { owner: ownerId, status: 'ACTIVE' },
        { $set: { status: 'CANCELLED' } },
      )
      .exec();

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setFullYear(endsAt.getFullYear() + 50);
    // Devise FREE selon région Partner (pricingByRegion).
    const pricing = this.plans.resolvePricingForRegion(plan, pricingRegion);
    const doc = await this.subModel.create({
      owner: ownerId,
      plan: plan._id as Types.ObjectId,
      billingPeriod: 'MONTHLY',
      status: 'ACTIVE',
      startsAt: now,
      endsAt,
      pricePaid: 0,
      currency: pricing.currency,
      planName: String(plan.name ?? 'FREE'),
      isTrial: false,
      trialEndsAt: null,
      trialRemindersSent: [],
    });
    const mapped = mapSub(doc.toObject() as Record<string, unknown>);
    // Changement de formule explicite (pas le backfill silencieux ensure*).
    this.queueSubscriptionLifecycleNotify({
      userId: String(user._id),
      subscriptionId: mapped.id,
      planName: mapped.planName,
      kind: 'CHANGED',
      email: String(user.email ?? ''),
      name: String(user.fullName ?? '').trim() || String(user.email ?? ''),
    });
    return mapped;
  }

  private assertPartner(user: UserModel) {
    if (user.type !== UserTypeEnum.PARTNER) {
      throw new ForbiddenException('partner_subscriptions_partner_only');
    }
  }

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  private stripe(): StripeClient {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) throw new BadRequestException('stripe_not_configured');
    return new Stripe(key);
  }

  private successUrl(): string {
    // Partner → toujours portail business (jamais admin.wise-eat.com).
    const portalBase = resolvePortalAppBaseUrl({
      getEnv: (key) => this.config.get<string>(key),
      audience: 'business',
    });
    const base = `${portalBase}/settings/partner-subscription`;
    const configured =
      this.config.get<string>('STRIPE_PARTNER_SUBSCRIPTION_SUCCESS_URL')?.trim() ||
      '';
    const raw = configured || base;
    return raw.includes('{CHECKOUT_SESSION_ID}')
      ? raw
      : `${raw}${raw.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
  }

  private cancelUrl(): string {
    const portalBase = resolvePortalAppBaseUrl({
      getEnv: (key) => this.config.get<string>(key),
      audience: 'business',
    });
    return (
      this.config.get<string>('STRIPE_PARTNER_SUBSCRIPTION_CANCEL_URL')?.trim() ||
      `${portalBase}/settings/partner-subscription`
    );
  }

  async getMine(user: UserModel) {
    this.assertPartner(user);
    // Lazy default FREE (signup partenaire / comptes sans sub).
    await this.ensurePartnerDefaultFreePlan(user._id as Types.ObjectId);
    const ownerId = new Types.ObjectId(String(user._id));
    const now = new Date();
    // Préférer un ACTIVE encore valide ; sinon PENDING_PAYMENT récent.
    let active = await this.subModel
      .findOne({
        owner: ownerId,
        status: 'ACTIVE',
        endsAt: { $gt: now },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!active) {
      active = await this.subModel
        .findOne({
          owner: ownerId,
          status: { $in: ['ACTIVE', 'PENDING_PAYMENT'] },
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec();
    }
    const history = await this.subModel
      .find({ owner: ownerId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();
    return {
      active: active
        ? mapSub(active as Record<string, unknown>)
        : null,
      history: (history as Record<string, unknown>[]).map(mapSub),
    };
  }

  /**
   * Admin — historique global des abonnements Partner (parité vendeur
   * `GET /subscriptions/vendor-subscriptions`).
   */
  async listSubscriptionsAdmin(user: UserModel) {
    this.assertAdmin(user);
    const rows = await this.subModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec();

    const ownerIds = [
      ...new Set(
        (rows as { owner?: Types.ObjectId }[])
          .map((r) => String(r.owner ?? ''))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const owners = await this.userModel
      .find({ _id: { $in: ownerIds } })
      .select('fullName email')
      .lean()
      .exec();
    const ownerById = new Map(
      owners.map((o) => [
        String(o._id),
        {
          ownerName: String(o.fullName ?? '').trim(),
          ownerEmail: String(o.email ?? '').trim(),
        },
      ]),
    );

    return (rows as Record<string, unknown>[]).map((r) => {
      const mapped = mapSub(r);
      const ownerMeta = ownerById.get(String(r.owner ?? '')) ?? {
        ownerName: '',
        ownerEmail: '',
      };
      // Identité owner pour la table admin + champs abonnement complets.
      return {
        ...mapped,
        ...mergePartnerSubscriptionAdminRow({
          mapped,
          ownerName: ownerMeta.ownerName,
          ownerEmail: ownerMeta.ownerEmail,
        }),
      };
    });
  }

  /** Plan ACTIVE (ou essai) courant pour un user Partner. */
  async findActiveSubscriptionForOwner(ownerId: string) {
    if (!Types.ObjectId.isValid(ownerId)) return null;
    const now = new Date();
    return this.subModel
      .findOne({
        owner: new Types.ObjectId(ownerId),
        status: 'ACTIVE',
        endsAt: { $gt: now },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async startTrial(user: UserModel, dto: StartPartnerTrialDto) {
    this.assertPartner(user);
    const plan = await this.plans.getPlanLean(dto.planId);
    if (!plan || plan.active === false) {
      throw new NotFoundException('partner_plan_not_found');
    }
    const trialDays = Math.max(0, Number(plan.trialDays ?? 0));
    if (trialDays <= 0) {
      throw new BadRequestException('partner_plan_no_trial');
    }
    // Devise d’essai alignée sur la région Partner (pricingByRegion).
    const pricingRegion = await this.plans.resolvePricingRegionForUser(
      user,
      dto.regionCode,
    );
    const pricing = this.plans.resolvePricingForRegion(
      plan as Record<string, unknown>,
      pricingRegion,
    );
    const ownerId = new Types.ObjectId(String(user._id));
    const priorTrial = await this.subModel
      .countDocuments({ owner: ownerId, isTrial: true })
      .exec();
    if (priorTrial > 0) {
      throw new BadRequestException('partner_trial_already_used');
    }
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + trialDays * 86_400_000);
    // Clôturer ACTIVE existants avant essai (évite double ACTIVE).
    await this.subModel
      .updateMany(
        { owner: ownerId, status: 'ACTIVE' },
        { $set: { status: 'CANCELLED' } },
      )
      .exec();
    const doc = await this.subModel.create({
      owner: ownerId,
      plan: plan._id,
      billingPeriod: 'MONTHLY',
      status: 'ACTIVE',
      startsAt,
      endsAt,
      pricePaid: 0,
      currency: pricing.currency,
      planName: String(plan.name ?? ''),
      isTrial: true,
      trialEndsAt: endsAt,
      trialRemindersSent: [],
    });
    const mapped = mapSub(doc.toObject() as Record<string, unknown>);
    this.queueSubscriptionLifecycleNotify({
      userId: String(user._id),
      subscriptionId: mapped.id,
      planName: mapped.planName,
      kind: 'CHANGED',
      email: String(user.email ?? ''),
      name: String(user.fullName ?? '').trim() || String(user.email ?? ''),
    });
    return mapped;
  }

  /**
   * Prépare un pending payant (ou active FREE). Partagé Checkout hébergé + PaymentIntent.
   */
  private async resolvePaidPendingOrFree(user: UserModel, dto: SubscribePartnerDto) {
    const plan = await this.plans.getPlanLean(dto.planId);
    if (!plan || plan.active === false) {
      throw new NotFoundException('partner_plan_not_found');
    }
    const period: PartnerSubscriptionBillingPeriod =
      dto.billingPeriod === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
    // Facturation = région d’exercice Partner (pas le défaut CAD du plan).
    const pricingRegion = await this.plans.resolvePricingRegionForUser(
      user,
      dto.regionCode,
    );
    const pricing = this.plans.resolvePricingForRegion(
      plan as Record<string, unknown>,
      pricingRegion,
    );
    const pricePaid =
      period === 'YEARLY' ? pricing.priceYearly : pricing.priceMonthly;
    // FREE : nom FREE ou prix régionaux à 0 (pas seulement les défauts globaux).
    const planIsFree = isFreeSubscriptionPlan({
      name: String(plan.name ?? ''),
      priceMonthly: pricing.priceMonthly,
      priceYearly: pricing.priceYearly,
    });
    if (planIsFree || pricePaid <= 0) {
      const subscription = await this.activateFreePlan(user, String(plan._id));
      return { kind: 'free' as const, subscription };
    }
    // Facteur Régions (CM / XAF → ×1 « Montants entiers », CA / CAD → ×100).
    const stripeFactor =
      await this.supportedCountries.resolveStripeAmountFactorForCheckout({
        currency: pricing.currency,
        userCountryCode:
          pricingRegion ??
          (user as UserModel & { appCountryCode?: string }).appCountryCode,
      });
    const unitAmountMinor = partnerPriceToStripeMinorUnits(
      pricePaid,
      stripeFactor,
    );
    const minMinor = partnerStripeMinimumMinorUnits(stripeFactor);
    if (unitAmountMinor < minMinor) {
      throw new BadRequestException({
        message: 'amount_below_stripe_minimum',
        pricePaid,
        currency: pricing.currency,
        unitAmountMinor,
        stripeAmountFactor: stripeFactor,
      });
    }
    const ownerId = new Types.ObjectId(String(user._id));
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    if (period === 'YEARLY') endsAt.setFullYear(endsAt.getFullYear() + 1);
    else endsAt.setMonth(endsAt.getMonth() + 1);

    const pending = await this.subModel.create({
      owner: ownerId,
      plan: plan._id,
      billingPeriod: period,
      status: 'PENDING_PAYMENT',
      startsAt,
      endsAt,
      pricePaid,
      currency: pricing.currency,
      planName: String(plan.name ?? ''),
      isTrial: false,
    });

    return {
      kind: 'pending' as const,
      plan,
      period,
      pricing,
      pricePaid,
      unitAmountMinor,
      pending,
    };
  }

  /** Active un pending après paiement réussi (Checkout ou PaymentIntent). */
  private async activatePendingSubscription(
    subId: string,
    args: {
      expectedOwnerId: string;
      stripeCheckoutSessionId?: string;
      stripePaymentIntentId?: string;
    },
  ) {
    if (!Types.ObjectId.isValid(subId)) {
      throw new NotFoundException('partner_subscription_not_found');
    }
    const sub = await this.subModel.findById(subId).exec();
    if (!sub) throw new NotFoundException('partner_subscription_not_found');
    if (String(sub.owner) !== args.expectedOwnerId) {
      throw new ForbiddenException('partner_subscription_owner_mismatch');
    }
    // Déjà actif (sync idempotent après Payment Sheet) — pas de re-notif.
    if (sub.status === 'ACTIVE') {
      return mapSub(sub.toObject() as Record<string, unknown>);
    }
    await this.subModel
      .updateMany(
        {
          owner: sub.owner,
          _id: { $ne: sub._id },
          status: 'ACTIVE',
        },
        { $set: { status: 'CANCELLED' } },
      )
      .exec();
    sub.status = 'ACTIVE';
    if (args.stripeCheckoutSessionId) {
      sub.stripeCheckoutSessionId = args.stripeCheckoutSessionId;
    }
    if (args.stripePaymentIntentId) {
      sub.stripePaymentIntentId = args.stripePaymentIntentId;
    }
    await sub.save();
    const mapped = mapSub(sub.toObject() as Record<string, unknown>);
    const owner = await this.userModel
      .findById(sub.owner)
      .select('fullName email')
      .lean()
      .exec();
    this.queueSubscriptionLifecycleNotify({
      userId: String(sub.owner),
      subscriptionId: mapped.id,
      planName: mapped.planName,
      kind: 'CHANGED',
      email: String(owner?.email ?? ''),
      name:
        String(owner?.fullName ?? '').trim() || String(owner?.email ?? ''),
    });
    return mapped;
  }

  /**
   * Fire-and-forget inbox + push + e-mail (ne bloque pas l’HTTP / Stripe sync).
   */
  private queueSubscriptionLifecycleNotify(args: {
    userId: string;
    subscriptionId: string;
    planName: string;
    kind: 'CHANGED' | 'EXPIRED' | 'TRIAL_REMINDER';
    email: string;
    name: string;
    daysRemaining?: number;
    trialEndsAt?: string;
  }) {
    void this.notifications
      .notifyPartnerSubscriptionLifecycle({
        recipientUserId: args.userId,
        subscriptionId: args.subscriptionId,
        kind: args.kind,
        planName: args.planName,
        daysRemaining: args.daysRemaining,
        trialEndsAt: args.trialEndsAt,
      })
      .catch((e) =>
        this.logger.warn(
          `partner sub lifecycle push kind=${args.kind}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

    const email = args.email.trim();
    if (!email) return;
    const name = args.name.trim() || email;
    const planName = args.planName.trim() || 'votre formule';
    if (args.kind === 'CHANGED') {
      void this.partnerEmails
        .notifyPartnerSubscriptionChanged({ email, name, planName })
        .catch((e) =>
          this.logger.warn(
            `partner sub changed email: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
      return;
    }
    if (args.kind === 'EXPIRED') {
      void this.partnerEmails
        .notifyPartnerSubscriptionExpired({ email, name, planName })
        .catch((e) =>
          this.logger.warn(
            `partner sub expired email: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
      return;
    }
    if (args.kind === 'TRIAL_REMINDER') {
      void this.partnerEmails
        .notifyPartnerSubscriptionTrialReminder({
          email,
          name,
          planName,
          daysRemaining: args.daysRemaining ?? 1,
        })
        .catch((e) =>
          this.logger.warn(
            `partner sub trial reminder email: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    }
  }

  /**
   * PaymentIntent pour Payment Sheet mobile (recommandé) — pas de navigateur.
   */
  async createPaymentIntent(user: UserModel, dto: SubscribePartnerDto) {
    this.assertPartner(user);
    const resolved = await this.resolvePaidPendingOrFree(user, dto);
    if (resolved.kind === 'free') {
      return {
        activated: true as const,
        subscription: resolved.subscription,
      };
    }
    const { pending, period, pricing, unitAmountMinor, plan } = resolved;
    const stripe = this.stripe();
    const pi = await stripe.paymentIntents.create({
      amount: unitAmountMinor,
      currency: pricing.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      receipt_email: user.email || undefined,
      description: `Wise Eat Partner · ${String(plan.name ?? 'Plan')}`,
      metadata: {
        kind: METADATA_KIND,
        partnerSubscriptionId: String(pending._id),
        partnerUserId: String(user._id),
        planId: String(plan._id),
        billingPeriod: period,
      },
    });
    if (!pi.client_secret) {
      await this.subModel.deleteOne({ _id: pending._id }).exec();
      throw new BadRequestException('stripe_missing_payment_intent_secret');
    }
    await this.subModel
      .updateOne(
        { _id: pending._id },
        { $set: { stripePaymentIntentId: pi.id } },
      )
      .exec();
    return {
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      subscriptionId: String(pending._id),
    };
  }

  /** Active l’abonnement après Payment Sheet (idempotent). */
  async syncPaymentIntentForUser(user: UserModel, paymentIntentId: string) {
    this.assertPartner(user);
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
    if (!isPartnerSubscriptionPaymentIntentKind(pi.metadata?.kind)) {
      throw new BadRequestException('not_partner_subscription_payment_intent');
    }
    if (String(pi.metadata?.partnerUserId ?? '') !== String(user._id)) {
      throw new ForbiddenException('payment_intent_user_mismatch');
    }
    const subId = pi.metadata?.partnerSubscriptionId?.trim();
    if (!subId) {
      throw new BadRequestException('partner_subscription_id_missing');
    }
    const subscription = await this.activatePendingSubscription(subId, {
      expectedOwnerId: String(user._id),
      stripePaymentIntentId: pi.id,
    });
    return { activated: true as const, subscription };
  }

  /** Checkout hébergé (admin web / secours navigateur). */
  async createCheckoutSession(user: UserModel, dto: SubscribePartnerDto) {
    this.assertPartner(user);
    const resolved = await this.resolvePaidPendingOrFree(user, dto);
    if (resolved.kind === 'free') {
      return {
        activated: true as const,
        subscription: resolved.subscription,
        url: null as string | null,
        sessionId: null as string | null,
      };
    }
    const { pending, period, pricing, unitAmountMinor, plan } = resolved;
    const currency = pricing.currency.toLowerCase();
    const stripe = this.stripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: this.successUrl(),
      cancel_url: this.cancelUrl(),
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmountMinor,
            product_data: {
              name: `Wise Eat Partner — ${String(plan.name ?? 'Plan')}`,
              description:
                period === 'YEARLY' ? 'Abonnement annuel' : 'Abonnement mensuel',
            },
          },
        },
      ],
      metadata: {
        kind: METADATA_KIND,
        partnerSubscriptionId: String(pending._id),
        partnerUserId: String(user._id),
        planId: String(plan._id),
        billingPeriod: period,
      },
    });

    await this.subModel
      .updateOne(
        { _id: pending._id },
        { $set: { stripeCheckoutSessionId: session.id } },
      )
      .exec();

    return {
      url: session.url,
      sessionId: session.id,
      subscriptionId: String(pending._id),
    };
  }

  async confirmCheckout(user: UserModel, sessionId: string) {
    this.assertPartner(user);
    const sid = sessionId?.trim();
    if (!sid) throw new BadRequestException('session_id_required');
    const stripe = this.stripe();
    const session = await stripe.checkout.sessions.retrieve(sid);
    if (!isPartnerSubscriptionPaymentIntentKind(session.metadata?.kind)) {
      throw new BadRequestException('invalid_checkout_kind');
    }
    if (session.payment_status !== 'paid') {
      throw new BadRequestException('checkout_not_paid');
    }
    const subId = session.metadata?.partnerSubscriptionId;
    if (!subId) {
      throw new NotFoundException('partner_subscription_not_found');
    }
    return this.activatePendingSubscription(subId, {
      expectedOwnerId: String(user._id),
      stripeCheckoutSessionId: sid,
      stripePaymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : undefined,
    });
  }
}
