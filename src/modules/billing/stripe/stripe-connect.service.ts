import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AddressModel } from '@schemas/address.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { WsStripeConnectNotifyService } from '@modules/ws-notify/ws-stripe-connect-notify.service';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

/** Comptes vendeurs Afrika Meals : toujours entreprise (restaurant). */
const CONNECT_BUSINESS_TYPE = 'company' as const;

/** MCC « Restaurants » (repas sur place / à emporter). */
const DEFAULT_RESTAURANT_MCC = '5812';

export type StripeConnectLifecycleStatus =
  | 'not_created'
  | 'incomplete'
  | 'pending_verification'
  | 'active'
  | 'restricted'
  | 'rejected';

export type StripeConnectStatus = {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingComplete: boolean;
  status: StripeConnectLifecycleStatus;
  businessType: typeof CONNECT_BUSINESS_TYPE;
  country: string | null;
  defaultCurrency: string | null;
  requirementsDue: string[];
  requirementsPastDue: string[];
  disabledReason: string | null;
};

export type StripeConnectPayoutRow = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: string | null;
  createdAt: string;
  method: string;
  description: string | null;
};

type StripeAddressBlock = {
  line1: string;
  city?: string;
  postal_code?: string;
  state?: string;
  country: string;
};

type RepresentativePrefill = {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  address?: StripeAddressBlock;
};

type VendorPrefill = {
  accountCountry: string;
  company: Record<string, unknown>;
  business_profile: Record<string, unknown>;
  /** Représentant légal — via API Persons, pas `accounts.*.individual`. */
  representative: RepresentativePrefill;
};

/** Compte Connect Express tel que renvoyé par l’API Stripe (sans namespace `Stripe.Account`). */
type StripeConnectAccountRecord = {
  id: string;
  business_type?: string | null;
  country?: string | null;
  default_currency?: string | null;
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  charges_enabled?: boolean;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[] | null;
    past_due?: string[] | null;
  } | null;
};

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 1) {
    const n = parts[0] || 'Propriétaire';
    return { firstName: n, lastName: n };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizeCountryCode(raw: string | undefined): string {
  const c = String(raw ?? 'CA')
    .trim()
    .toUpperCase();
  if (c.length === 2) return c;
  if (c === 'CANADA') return 'CA';
  if (c === 'USA' || c === 'UNITED STATES') return 'US';
  return 'CA';
}

function phoneToE164(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim();
  if (s.startsWith('+') && !s.includes('_')) {
    const digits = s.replace(/\D/g, '');
    return digits ? `+${digits}` : undefined;
  }
  const head = s.split('-')[0];
  const u = head.indexOf('_');
  if (u === -1) {
    const digits = s.replace(/\D/g, '');
    return digits ? `+${digits}` : undefined;
  }
  const cc = head.slice(0, u).replace(/\D/g, '');
  const national = head.slice(u + 1).replace(/\D/g, '');
  if (!cc || !national) return undefined;
  return `+${cc}${national}`;
}

const CA_PROVINCE_CODES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

function inferCanadianAddressParts(line1: string): {
  state?: string;
  postal_code?: string;
} {
  const s = line1.trim();
  if (!s) return {};
  const postalMatch = s.match(/([A-Za-z]\d[A-Za-z])\s*(\d[A-Za-z]\d)/);
  const postal_code = postalMatch
    ? `${postalMatch[1].toUpperCase()} ${postalMatch[2].toUpperCase()}`
    : undefined;
  const headProv = s.match(/^([A-Za-z]{2})(?=[\s,-])/);
  let state: string | undefined;
  if (headProv && CA_PROVINCE_CODES.has(headProv[1].toUpperCase())) {
    state = headProv[1].toUpperCase();
  }
  return { ...(state ? { state } : {}), ...(postal_code ? { postal_code } : {}) };
}

function buildAddressBlock(
  addr: AddressModel | undefined,
  storeLine?: string,
  countryFallback = 'CA',
): StripeAddressBlock | undefined {
  const line1 =
    (typeof addr?.address === 'string' && addr.address.trim()) ||
    (typeof storeLine === 'string' && storeLine.trim()) ||
    undefined;
  if (!line1) return undefined;

  const accountCountry = normalizeCountryCode(addr?.countryCode ?? countryFallback);
  let postal_code = addr?.zipCode?.trim();
  let state: string | undefined;
  if (accountCountry === 'CA') {
    const inferred = inferCanadianAddressParts(line1);
    state = inferred.state;
    if (!postal_code && inferred.postal_code) postal_code = inferred.postal_code;
  }

  return {
    line1: line1.slice(0, 200),
    ...(typeof addr?.city === 'string' && addr.city.trim()
      ? { city: addr.city.trim().slice(0, 100) }
      : {}),
    ...(postal_code ? { postal_code } : {}),
    ...(state ? { state } : {}),
    country: accountCountry,
  };
}

function buildVendorPrefill(
  user: UserModel,
  store: (StoreModel & { address?: AddressModel }) | null,
): VendorPrefill {
  const businessName =
    store?.name?.trim() || user.fullName?.trim() || 'Restaurant Afrika Meals';
  const accountEmail = user.email?.trim() || '';
  const phoneE164 =
    phoneToE164(user.phoneNumber) || phoneToE164(store?.phoneNumber);
  const { firstName, lastName } = splitFullName(user.fullName);
  const addressBlock = buildAddressBlock(
    store?.address as AddressModel | undefined,
    undefined,
    normalizeCountryCode(store?.address?.countryCode),
  );
  const accountCountry = addressBlock?.country ?? 'CA';

  const productDescription = store?.bio?.trim()
    ? `Restaurant et livraison de repas. ${store.bio.trim()}`.slice(0, 1000)
    : 'Restaurant et service de repas / livraison sur la plateforme Afrika Meals.';

  const company: Record<string, unknown> = {
    name: businessName.slice(0, 100),
    ...(phoneE164 ? { phone: phoneE164 } : {}),
    ...(addressBlock ? { address: addressBlock } : {}),
  };

  const business_profile: Record<string, unknown> = {
    name: businessName.slice(0, 100),
    mcc: DEFAULT_RESTAURANT_MCC,
    product_description: productDescription,
    ...(phoneE164 ? { support_phone: phoneE164 } : {}),
    ...(accountEmail ? { support_email: accountEmail } : {}),
  };

  const representative: RepresentativePrefill = {
    email: accountEmail,
    first_name: firstName,
    last_name: lastName,
    ...(phoneE164 ? { phone: phoneE164 } : {}),
    ...(addressBlock ? { address: addressBlock } : {}),
  };

  return { accountCountry, company, business_profile, representative };
}

/** Message client (FR) — jamais de clé API ni message Stripe brut. */
function userFacingStripeConnectError(error: unknown): string {
  const msg =
    error instanceof Error ? error.message : String(error ?? '');
  const lower = msg.toLowerCase();
  if (/individual.*parameters.*business_type/i.test(msg)) {
    return 'stripe_connect_company_prefill_error';
  }
  if (/business_type|company|individual/i.test(lower) && /invalid/i.test(lower)) {
    return 'stripe_connect_company_prefill_error';
  }
  if (isStripeConnectAccountUnavailableError(error)) {
    return 'stripe_connect_account_unavailable';
  }
  return 'stripe_connect_create_failed';
}

function resolveConnectLifecycleStatus(
  account: StripeConnectAccountRecord | null,
): StripeConnectLifecycleStatus {
  if (!account) return 'not_created';
  const r = account.requirements;
  const disabled = r?.disabled_reason?.trim() || null;
  const currentlyDue = r?.currently_due ?? [];
  const pastDue = r?.past_due ?? [];

  if (disabled) {
    if (
      disabled.startsWith('rejected') ||
      disabled === 'listed' ||
      disabled.includes('rejected')
    ) {
      return 'rejected';
    }
    return 'restricted';
  }
  if (!account.details_submitted) return 'incomplete';
  if (pastDue.length > 0) {
    return !account.payouts_enabled ? 'restricted' : 'pending_verification';
  }
  if (currentlyDue.length > 0) {
    return !account.payouts_enabled ? 'restricted' : 'pending_verification';
  }
  if (isConnectFullyActive(account)) return 'active';
  if (account.details_submitted && !account.payouts_enabled) {
    return 'pending_verification';
  }
  return 'incomplete';
}

/** Compte Connect supprimé, révoqué ou inaccessible (sans exposer la clé API au client). */
function isStripeConnectAccountUnavailableError(error: unknown): boolean {
  const e = error as {
    type?: string;
    code?: string;
    statusCode?: number;
    message?: string;
    raw?: { code?: string };
  };
  const msg = typeof e?.message === 'string' ? e.message.toLowerCase() : '';
  const code = String(e?.code ?? e?.raw?.code ?? '').toLowerCase();
  if (e?.statusCode === 404) return true;
  if (code === 'account_invalid' || code === 'resource_missing') return true;
  if (msg.includes('does not have access to account')) return true;
  if (msg.includes('does not exist')) return true;
  if (msg.includes('application access may have been revoked')) return true;
  if (msg.includes('no such destination')) return true;
  if (msg.includes('no such account')) return true;
  return false;
}

function isConnectFullyActive(account: {
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  charges_enabled?: boolean;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[] | null;
    past_due?: string[] | null;
  } | null;
}): boolean {
  const r = account.requirements;
  const noBlockingDue =
    !(r?.currently_due?.length) && !(r?.past_due?.length);
  return !!(
    account.details_submitted &&
    account.payouts_enabled &&
    account.charges_enabled &&
    !r?.disabled_reason &&
    noBlockingDue
  );
}

@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    private readonly wsStripeConnectNotify: WsStripeConnectNotifyService,
  ) {}

  private stripe(): StripeClient {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new BadRequestException('stripe_not_configured');
    }
    return new Stripe(key);
  }

  private assertVendor(user: UserModel) {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
  }

  private userId(user: UserModel): Types.ObjectId {
    const raw =
      (user as UserModel & { _id?: Types.ObjectId | string })._id ?? user.id;
    if (raw instanceof Types.ObjectId) return raw;
    return new Types.ObjectId(String(raw));
  }

  private connectReturnUrls(): { returnUrl: string; refreshUrl: string } {
    const adminBase =
      this.config.get<string>('STRIPE_CONNECT_ADMIN_BASE_URL')?.trim() ||
      this.config.get<string>('ADMIN_APP_URL')?.trim() ||
      'http://localhost:3000';
    const base = adminBase.replace(/\/+$/, '');
    return {
      returnUrl:
        this.config.get<string>('STRIPE_CONNECT_RETURN_URL')?.trim() ||
        `${base}/finances/versements?connect=return`,
      refreshUrl:
        this.config.get<string>('STRIPE_CONNECT_REFRESH_URL')?.trim() ||
        `${base}/finances/versements?connect=refresh`,
    };
  }

  /** Retire un `stripeConnectAccountId` obsolète (compte supprimé côté Stripe). */
  private async clearStaleConnectAccount(userId: Types.ObjectId): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: userId },
        {
          $set: {
            stripeConnectAccountId: null,
            stripeConnectChargesEnabled: false,
            stripeConnectPayoutsEnabled: false,
            stripeConnectDetailsSubmitted: false,
            stripeConnectDisabledReason: null,
            stripeConnectRequirementsDue: [],
            stripeConnectRequirementsPastDue: [],
          },
        },
      )
      .exec();
  }

  private async primaryStoreForVendor(
    userId: Types.ObjectId,
  ): Promise<(StoreModel & { address?: AddressModel }) | null> {
    const store = await this.storeModel
      .findOne({ owner: userId })
      .populate<{ address: AddressModel }>('address')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return store as (StoreModel & { address?: AddressModel }) | null;
  }

  private async syncAccountFlags(
    userId: Types.ObjectId,
    account: StripeConnectAccountRecord,
  ): Promise<void> {
    const requirements = account.requirements;
    await this.userModel
      .updateOne(
        { _id: userId },
        {
          $set: {
            stripeConnectAccountId: account.id,
            stripeConnectChargesEnabled: Boolean(account.charges_enabled),
            stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
            stripeConnectDetailsSubmitted: Boolean(account.details_submitted),
            stripeConnectDisabledReason:
              requirements?.disabled_reason?.trim() || null,
            stripeConnectRequirementsDue: requirements?.currently_due ?? [],
            stripeConnectRequirementsPastDue: requirements?.past_due ?? [],
          },
        },
      )
      .exec();
  }

  private buildAccountUpdateBody(
    prefill: VendorPrefill,
    account: StripeConnectAccountRecord,
    email: string | undefined,
  ): Record<string, unknown> {
    const isLegacyIndividual = account.business_type === 'individual';
    if (isLegacyIndividual) {
      return {
        ...(email ? { email } : {}),
        business_profile: prefill.business_profile,
      };
    }
    return {
      ...(email ? { email } : {}),
      business_type: CONNECT_BUSINESS_TYPE,
      company: prefill.company,
      business_profile: prefill.business_profile,
    };
  }

  /** Représentant légal (comptes `company` uniquement). */
  private async syncRepresentativePerson(
    accountId: string,
    prefill: VendorPrefill,
  ): Promise<void> {
    const rep = prefill.representative;
    if (!rep.email?.trim()) return;

    const stripe = this.stripe();
    const personPayload: Record<string, unknown> = {
      email: rep.email.trim(),
      first_name: rep.first_name,
      last_name: rep.last_name,
      ...(rep.phone ? { phone: rep.phone } : {}),
      ...(rep.address ? { address: rep.address } : {}),
      relationship: {
        representative: true,
        title: 'Propriétaire',
      },
    };

    try {
      const existing = await stripe.accounts.listPersons(accountId, {
        limit: 20,
      });
      const current = existing.data.find(
        (p) => p.relationship?.representative === true,
      );
      if (current?.id) {
        await stripe.accounts.updatePerson(accountId, current.id, personPayload);
      } else {
        await stripe.accounts.createPerson(accountId, personPayload);
      }
    } catch (e) {
      this.logger.warn(
        `Stripe Connect representative person skipped for ${accountId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async syncPrefillToAccount(
    accountId: string,
    account: StripeConnectAccountRecord,
    user: UserModel,
    store: (StoreModel & { address?: AddressModel }) | null,
  ): Promise<StripeConnectAccountRecord> {
    if (isConnectFullyActive(account)) {
      return account;
    }
    const prefill = buildVendorPrefill(user, store);
    try {
      await this.stripe().accounts.update(
        accountId,
        this.buildAccountUpdateBody(prefill, account, user.email?.trim()),
      );
      if (account.business_type !== 'individual') {
        await this.syncRepresentativePerson(accountId, prefill);
      }
      const refreshed = (await this.stripe().accounts.retrieve(
        accountId,
      )) as StripeConnectAccountRecord;
      this.logger.log(`Stripe Connect prefill synced for ${accountId}`);
      return refreshed;
    } catch (e) {
      this.logger.warn(
        `Stripe Connect prefill update skipped: ${e instanceof Error ? e.message : String(e)}`,
      );
      return account;
    }
  }

  private statusFromAccount(
    account: StripeConnectAccountRecord | null,
  ): StripeConnectStatus {
    if (!account) {
      return {
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        onboardingComplete: false,
        status: 'not_created',
        businessType: CONNECT_BUSINESS_TYPE,
        country: null,
        defaultCurrency: null,
        requirementsDue: [],
        requirementsPastDue: [],
        disabledReason: null,
      };
    }
    const requirements = account.requirements;
    return {
      accountId: account.id,
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      onboardingComplete: isConnectFullyActive(account),
      status: resolveConnectLifecycleStatus(account),
      businessType: CONNECT_BUSINESS_TYPE,
      country: account.country ?? null,
      defaultCurrency: account.default_currency ?? null,
      requirementsDue: requirements?.currently_due ?? [],
      requirementsPastDue: requirements?.past_due ?? [],
      disabledReason: requirements?.disabled_reason?.trim() || null,
    };
  }

  private pushConnectStatusRealtime(
    userId: Types.ObjectId,
    status: StripeConnectStatus,
  ): void {
    this.wsStripeConnectNotify.notifyVendorConnectStatus(
      userId.toString(),
      status as unknown as Record<string, unknown>,
    );
  }

  /** Webhook `account.updated` — synchronise le statut vendeur + push WS. */
  async handleAccountUpdated(account: StripeConnectAccountRecord): Promise<void> {
    const accountId = account.id;
    const user = await this.userModel
      .findOne({ stripeConnectAccountId: accountId })
      .exec();
    if (!user) return;
    const uid = this.userId(user);
    await this.syncAccountFlags(uid, account);
    const status = this.statusFromAccount(account);
    this.pushConnectStatusRealtime(uid, status);
    this.logger.log(
      `Stripe Connect account.updated synced for user ${uid} (status=${status.status})`,
    );
  }

  async getConnectStatus(user: UserModel): Promise<StripeConnectStatus> {
    this.assertVendor(user);
    const uid = this.userId(user);
    const doc = await this.userModel
      .findById(uid)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue email fullName phoneNumber',
      )
      .exec();
    const accountId = doc?.stripeConnectAccountId?.trim() || null;
    if (!accountId) {
      return this.statusFromAccount(null);
    }
    try {
      const account = await this.stripe().accounts.retrieve(accountId);
      await this.syncAccountFlags(uid, account);
      return this.statusFromAccount(account);
    } catch (e) {
      this.logger.warn(
        `Stripe account retrieve failed for ${accountId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(uid);
        const reset = this.statusFromAccount(null);
        this.pushConnectStatusRealtime(uid, reset);
        return reset;
      }
      const cachedAccount: StripeConnectAccountRecord = {
        id: accountId,
        charges_enabled: doc?.stripeConnectChargesEnabled,
        payouts_enabled: doc?.stripeConnectPayoutsEnabled,
        details_submitted: doc?.stripeConnectDetailsSubmitted,
        requirements: {
          disabled_reason: doc?.stripeConnectDisabledReason ?? null,
          currently_due: doc?.stripeConnectRequirementsDue ?? [],
          past_due: doc?.stripeConnectRequirementsPastDue ?? [],
        },
      };
      return this.statusFromAccount(cachedAccount);
    }
  }

  async createOnboardingLink(
    user: UserModel,
  ): Promise<{ url: string; accountId: string }> {
    this.assertVendor(user);
    const uid = this.userId(user);
    const store = await this.primaryStoreForVendor(uid);
    const stripe = this.stripe();
    const { returnUrl, refreshUrl } = this.connectReturnUrls();
    const prefill = buildVendorPrefill(user, store);

    let accountId = (
      await this.userModel
        .findById(uid)
        .select('stripeConnectAccountId')
        .lean()
        .exec()
    )?.stripeConnectAccountId?.trim();

    let account: StripeConnectAccountRecord | null = null;

    if (accountId) {
      try {
        account = await stripe.accounts.retrieve(accountId);
      } catch (retrieveErr) {
        if (isStripeConnectAccountUnavailableError(retrieveErr)) {
          await this.clearStaleConnectAccount(uid);
        }
        accountId = undefined;
        account = null;
      }
    }

    if (!accountId) {
      try {
        account = (await stripe.accounts.create({
          type: 'express',
          country: prefill.accountCountry,
          email: user.email?.trim(),
          business_type: CONNECT_BUSINESS_TYPE,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            platform: 'africa-meals',
            userId: uid.toString(),
          },
          company: prefill.company,
          business_profile: prefill.business_profile,
        })) as StripeConnectAccountRecord;
        accountId = account.id;
        await this.syncRepresentativePerson(accountId, prefill);
        await this.syncAccountFlags(uid, account);
      } catch (createErr) {
        this.logger.error(
          `Stripe Connect account create failed: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
        );
        throw new BadRequestException(userFacingStripeConnectError(createErr));
      }
    } else if (account) {
      account = await this.syncPrefillToAccount(
        accountId,
        account,
        user,
        store,
      );
    }

    if (!accountId || !account) {
      throw new BadRequestException('stripe_connect_create_failed');
    }

    if (isConnectFullyActive(account)) {
      const login = await stripe.accounts.createLoginLink(accountId);
      if (!login.url) {
        throw new BadRequestException('stripe_dashboard_link_failed');
      }
      return { url: login.url, accountId };
    }

    const linkType: 'account_onboarding' | 'account_update' =
      account.details_submitted ? 'account_update' : 'account_onboarding';

    try {
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: linkType,
        return_url: returnUrl,
        refresh_url: refreshUrl,
        collect: 'eventually_due',
      });
      if (!link.url) {
        throw new BadRequestException('stripe_onboarding_link_failed');
      }
      return { url: link.url, accountId };
    } catch (linkErr) {
      if (linkType === 'account_update') {
        const fallback = await stripe.accountLinks.create({
          account: accountId,
          type: 'account_onboarding',
          return_url: returnUrl,
          refresh_url: refreshUrl,
          collect: 'eventually_due',
        });
        if (!fallback.url) {
          throw new BadRequestException('stripe_onboarding_link_failed');
        }
        return { url: fallback.url, accountId };
      }
      if (isStripeConnectAccountUnavailableError(linkErr)) {
        await this.clearStaleConnectAccount(uid);
        throw new BadRequestException('stripe_connect_account_unavailable');
      }
      throw new BadRequestException('stripe_onboarding_link_failed');
    }
  }

  async createDashboardLink(
    user: UserModel,
  ): Promise<{ url: string; status: 'complete' | 'incomplete' }> {
    this.assertVendor(user);
    const uid = this.userId(user);
    const accountId = (
      await this.userModel.findById(uid).select('stripeConnectAccountId').lean()
    )?.stripeConnectAccountId?.trim();
    if (!accountId) {
      throw new BadRequestException('stripe_connect_not_linked');
    }

    const store = await this.primaryStoreForVendor(uid);
    let account: StripeConnectAccountRecord;
    try {
      account = (await this.stripe().accounts.retrieve(
        accountId,
      )) as StripeConnectAccountRecord;
    } catch (e) {
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(uid);
        throw new BadRequestException('stripe_connect_account_unavailable');
      }
      throw new BadRequestException('stripe_dashboard_link_failed');
    }

    try {
      account = await this.syncPrefillToAccount(accountId, account, user, store);
      await this.syncAccountFlags(uid, account);

      if (isConnectFullyActive(account)) {
        const login = await this.stripe().accounts.createLoginLink(accountId);
        if (!login.url) {
          throw new BadRequestException('stripe_dashboard_link_failed');
        }
        return { url: login.url, status: 'complete' };
      }

      const { returnUrl, refreshUrl } = this.connectReturnUrls();
      const link = await this.stripe().accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });
      if (!link.url) {
        throw new BadRequestException('stripe_onboarding_link_failed');
      }
      return { url: link.url, status: 'incomplete' };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(uid);
        throw new BadRequestException('stripe_connect_account_unavailable');
      }
      throw new BadRequestException('stripe_dashboard_link_failed');
    }
  }

  async listPayouts(
    user: UserModel,
    limit = 25,
  ): Promise<{ payouts: StripeConnectPayoutRow[]; hasMore: boolean }> {
    this.assertVendor(user);
    const status = await this.getConnectStatus(user);
    if (!status.accountId) {
      return { payouts: [], hasMore: false };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const uid = this.userId(user);
    let list;
    try {
      list = await this.stripe().payouts.list(
        { limit: safeLimit },
        { stripeAccount: status.accountId },
      );
    } catch (e) {
      this.logger.warn(
        `Stripe payouts list failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(uid);
      }
      return { payouts: [], hasMore: false };
    }
    const payouts: StripeConnectPayoutRow[] = list.data.map((p) => ({
      id: p.id,
      amount: (p.amount ?? 0) / 100,
      currency: String(p.currency ?? 'cad').toUpperCase(),
      status: p.status,
      arrivalDate: p.arrival_date
        ? new Date(p.arrival_date * 1000).toISOString()
        : null,
      createdAt: new Date((p.created ?? 0) * 1000).toISOString(),
      method: p.method ?? 'standard',
      description: p.description ?? null,
    }));
    return { payouts, hasMore: list.has_more };
  }
}
