import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PlatformFeesService } from '@modules/platform-fees/platform-fees.service';
import { AddressModel } from '@schemas/address.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  type CountryCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { WsStripeConnectNotifyService } from '@modules/ws-notify/ws-stripe-connect-notify.service';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

/** Comptes vendeurs : entreprise (restaurant). */
const VENDOR_CONNECT_BUSINESS_TYPE = 'company' as const;
/** Comptes livreurs : particulier (indépendant). */
const DELIVERY_CONNECT_BUSINESS_TYPE = 'individual' as const;

type ConnectBusinessType =
  | typeof VENDOR_CONNECT_BUSINESS_TYPE
  | typeof DELIVERY_CONNECT_BUSINESS_TYPE;

function resolveConnectBusinessType(user: UserModel): ConnectBusinessType {
  return user.type === UserTypeEnum.DELIVERY
    ? DELIVERY_CONNECT_BUSINESS_TYPE
    : VENDOR_CONNECT_BUSINESS_TYPE;
}

/** Pays Stripe Connect — plateforme opère au Canada (évite CM/SN + numéros hors CA). */
const STRIPE_CONNECT_ACCOUNT_COUNTRY = 'CA' as const;

/** MCC « Restaurants » (repas sur place / à emporter). */
const DEFAULT_RESTAURANT_MCC = '5812';
/** MCC « Courier Services » (livraison). */
const DEFAULT_DELIVERY_MCC = '4215';

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
  businessType: ConnectBusinessType;
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

export type StripeConnectBalance = {
  available: number;
  pending: number;
  currency: string;
};

export type StripeConnectPayoutEstimate = {
  available: number;
  payoutFee: number;
  netPayout: number;
  currency: string;
  feeMode: 'fixed' | 'percent';
  feePercent: number;
  feeFixed: number;
  canRequestPayout: boolean;
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

type ConnectPrefill = {
  businessType: ConnectBusinessType;
  accountCountry: string;
  company: Record<string, unknown>;
  business_profile: Record<string, unknown>;
  /** Compte `individual` (livreur) — envoyé à `accounts.create`. */
  individual?: Record<string, unknown>;
  /** Représentant légal — via API Persons, comptes `company` uniquement. */
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

function splitFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
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

/** Numéro E.164 valide pour Stripe, ou `undefined` (ne jamais envoyer un numéro rejeté par Stripe). */
function phoneToE164(
  raw: string | undefined,
  defaultRegion?: string,
): string | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim();
  const region = defaultRegion
    ? (normalizeCountryCode(defaultRegion) as CountryCode)
    : undefined;

  const candidates: string[] = [s];
  if (s.includes('_')) {
    const head = s.split('-')[0];
    const sep = head.indexOf('_');
    if (sep !== -1) {
      const cc = head.slice(0, sep).replace(/\D/g, '');
      const national = head.slice(sep + 1).replace(/\D/g, '');
      if (cc && national) candidates.push(`+${cc}${national}`);
    }
  }
  if (!s.startsWith('+')) {
    const digits = s.replace(/\D/g, '');
    if (digits) candidates.push(`+${digits}`);
  }

  for (const candidate of candidates) {
    let parsed = parsePhoneNumberFromString(candidate);
    if (!parsed?.isValid() && region) {
      parsed = parsePhoneNumberFromString(candidate, region);
    }
    if (parsed?.isValid()) {
      return parsed.format('E.164');
    }
  }
  return undefined;
}

/** Téléphone prérempli Stripe : uniquement numéros canadiens valides (E.164). */
function phoneToE164ForStripeConnect(
  raw: string | undefined,
): string | undefined {
  const e164 = phoneToE164(raw, STRIPE_CONNECT_ACCOUNT_COUNTRY);
  if (!e164) return undefined;
  const parsed = parsePhoneNumberFromString(e164);
  if (parsed?.country !== STRIPE_CONNECT_ACCOUNT_COUNTRY) {
    return undefined;
  }
  return e164;
}

const CA_PROVINCE_CODES = new Set([
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
]);

const CA_PROVINCE_NAMES: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  colombiebritannique: 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'nouveau-brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  terreneuve: 'NL',
  'nova scotia': 'NS',
  'nouvelle-ecosse': 'NS',
  'northwest territories': 'NT',
  'northwest territory': 'NT',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  quebec: 'QC',
  québec: 'QC',
  saskatchewan: 'SK',
  yukon: 'YT',
};

function resolveCanadianProvinceCode(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [name, code] of Object.entries(CA_PROVINCE_NAMES)) {
    if (lower.includes(name)) return code;
  }
  const codeMatch = text.match(/\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/i);
  if (codeMatch && CA_PROVINCE_CODES.has(codeMatch[1].toUpperCase())) {
    return codeMatch[1].toUpperCase();
  }
  return undefined;
}

/** URL publique du site (Stripe `business_profile.url`) — doit être https://… */
function normalizeStripeBusinessUrl(raw: unknown): string | undefined {
  if (raw == null || typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  if (!/^https?:\/\//i.test(t)) return `https://${t.replace(/^\/+/, '')}`;
  return t;
}

/** Adresse boutique → champs Stripe (rue, ville, province QC, code postal). */
function buildAddressBlock(
  addr: AddressModel | undefined,
  storeLine?: string,
  countryFallback = 'CA',
): StripeAddressBlock | undefined {
  const rawLine =
    (typeof addr?.address === 'string' && addr.address.trim()) ||
    (typeof storeLine === 'string' && storeLine.trim()) ||
    undefined;
  if (!rawLine) return undefined;

  const accountCountry = normalizeCountryCode(
    addr?.countryCode ?? countryFallback,
  );
  let city = typeof addr?.city === 'string' ? addr.city.trim() : undefined;
  let postal_code = addr?.zipCode?.trim();
  let state: string | undefined;
  let street = rawLine;

  if (accountCountry === 'CA') {
    state = resolveCanadianProvinceCode(rawLine);
    const postalMatch = rawLine.match(/([A-Za-z]\d[A-Za-z])\s*(\d[A-Za-z]\d)/i);
    if (postalMatch) {
      postal_code = `${postalMatch[1].toUpperCase()} ${postalMatch[2].toUpperCase()}`;
    }

    let work = rawLine.replace(/,?\s*Canada\s*$/i, '').trim();
    if (postal_code) {
      work = work
        .replace(new RegExp(postal_code.replace(' ', '\\s*'), 'i'), '')
        .trim();
    }
    if (state) {
      for (const [name, code] of Object.entries(CA_PROVINCE_NAMES)) {
        work = work.replace(new RegExp(`\\b${name}\\b`, 'gi'), ' ');
      }
      work = work.replace(new RegExp(`\\b${state}\\b`, 'gi'), ' ');
    }
    work = work.replace(/\s+/g, ' ').replace(/,\s*,/g, ',').trim();

    const segments = work
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length >= 1) {
      street = segments[0];
      if (!city && segments.length >= 2) {
        const candidate = segments[1];
        if (!resolveCanadianProvinceCode(candidate)) {
          city = candidate;
        }
      }
    }
    street = street.replace(/\s+/g, ' ').trim();
    if (!state) {
      state = resolveCanadianProvinceCode(rawLine);
    }
  } else {
    street = rawLine;
  }

  return {
    line1: street.slice(0, 200),
    ...(city ? { city: city.slice(0, 100) } : {}),
    ...(postal_code
      ? {
          postal_code: postal_code
            .replace(/\s+/g, ' ')
            .toUpperCase()
            .slice(0, 20),
        }
      : {}),
    ...(state ? { state } : {}),
    country: accountCountry,
  };
}

function buildVendorPrefill(
  user: UserModel,
  store: (StoreModel & { address?: AddressModel }) | null,
  businessWebsiteUrl?: string,
  userAddress?: AddressModel | null,
): ConnectPrefill {
  const isDelivery = user.type === UserTypeEnum.DELIVERY;
  const businessType = resolveConnectBusinessType(user);
  const businessName = isDelivery
    ? user.fullName?.trim() || 'Livreur Afrika Meals'
    : store?.name?.trim() || user.fullName?.trim() || 'Restaurant Afrika Meals';
  const accountEmail = user.email?.trim() || '';
  const phoneE164 =
    phoneToE164ForStripeConnect(user.phoneNumber) ||
    phoneToE164ForStripeConnect(store?.phoneNumber);
  const { firstName, lastName } = splitFullName(user.fullName);
  const addressBlockRaw = buildAddressBlock(
    (store?.address as AddressModel | undefined) ?? userAddress ?? undefined,
    undefined,
    STRIPE_CONNECT_ACCOUNT_COUNTRY,
  );
  const addressBlock = addressBlockRaw
    ? { ...addressBlockRaw, country: STRIPE_CONNECT_ACCOUNT_COUNTRY }
    : undefined;
  const accountCountry = STRIPE_CONNECT_ACCOUNT_COUNTRY;

  const productDescription = isDelivery
    ? 'Livraison de repas pour la plateforme Afrika Meals. Versements liés aux courses effectuées.'
    : store?.bio?.trim()
    ? `Restaurant et livraison de repas. ${store.bio.trim()} Les clients sont débités lors du passage de commande sur Afrika Meals.`.slice(
        0,
        1000,
      )
    : 'Restaurant et livraison de repas sur Afrika Meals. Les clients sont débités lors du passage de commande en ligne.';

  const company: Record<string, unknown> = {
    name: businessName.slice(0, 100),
    ...(phoneE164 ? { phone: phoneE164 } : {}),
    ...(addressBlock ? { address: addressBlock } : {}),
  };

  const websiteUrl = normalizeStripeBusinessUrl(businessWebsiteUrl);

  const business_profile: Record<string, unknown> = {
    name: businessName.slice(0, 100),
    mcc: isDelivery ? DEFAULT_DELIVERY_MCC : DEFAULT_RESTAURANT_MCC,
    product_description: productDescription,
    ...(websiteUrl ? { url: websiteUrl } : {}),
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

  const individual: Record<string, unknown> | undefined = isDelivery
    ? {
        first_name: firstName,
        last_name: lastName,
        email: accountEmail,
        ...(phoneE164 ? { phone: phoneE164 } : {}),
        ...(addressBlock ? { address: addressBlock } : {}),
      }
    : undefined;

  return {
    businessType,
    accountCountry,
    company,
    business_profile,
    individual,
    representative,
  };
}

/** Message client (FR) — jamais de clé API ni message Stripe brut. */
function userFacingStripeConnectError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const lower = msg.toLowerCase();
  if (/individual.*parameters.*business_type/i.test(msg)) {
    return 'stripe_connect_company_prefill_error';
  }
  if (
    /business_type|company|individual/i.test(lower) &&
    /invalid/i.test(lower)
  ) {
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
  const noBlockingDue = !r?.currently_due?.length && !r?.past_due?.length;
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
    private readonly platformFees: PlatformFeesService,
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

  /** Clé secrète Stripe présente (API utilisable). */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('STRIPE_SECRET_KEY')?.trim());
  }

  async retrieveAccount(
    accountId: string,
  ): Promise<StripeConnectAccountRecord> {
    return (await this.stripe().accounts.retrieve(
      accountId.trim(),
    )) as StripeConnectAccountRecord;
  }

  async createExpressAccount(params: {
    email: string;
    country: string;
    businessName: string;
  }): Promise<{ id: string }> {
    const country =
      params.country.trim().toUpperCase().slice(0, 2) ||
      STRIPE_CONNECT_ACCOUNT_COUNTRY;
    const account = (await this.stripe().accounts.create({
      type: 'express',
      country,
      email: params.email.trim(),
      business_type: VENDOR_CONNECT_BUSINESS_TYPE,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        name: params.businessName.trim() || 'Restaurant',
        mcc: DEFAULT_RESTAURANT_MCC,
      },
      company: {
        name: params.businessName.trim() || 'Restaurant',
      },
      metadata: { platform: 'africa-meals' },
    })) as StripeConnectAccountRecord;
    return { id: account.id };
  }

  async createAccountOnboardingLink(
    accountId: string,
    refreshUrl: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const link = await this.stripe().accountLinks.create({
      account: accountId.trim(),
      type: 'account_onboarding',
      refresh_url: refreshUrl,
      return_url: returnUrl,
      collect: 'eventually_due',
    });
    if (!link.url) {
      throw new BadRequestException('stripe_onboarding_link_failed');
    }
    return { url: link.url };
  }

  /**
   * Rafraîchit les flags Connect en cache sur `users` depuis Stripe
   * (utile juste après l’onboarding avant webhook `account.updated`).
   */
  async refreshUserConnectFlagsFromStripe(
    ownerId: Types.ObjectId | string,
  ): Promise<void> {
    if (!this.isConfigured()) return;
    const oid =
      ownerId instanceof Types.ObjectId
        ? ownerId
        : new Types.ObjectId(String(ownerId));
    const doc = await this.userModel
      .findById(oid)
      .select('stripeConnectAccountId')
      .lean()
      .exec();
    const accountId = doc?.stripeConnectAccountId?.trim();
    if (!accountId) return;
    try {
      const account = (await this.stripe().accounts.retrieve(
        accountId,
      )) as StripeConnectAccountRecord;
      await this.syncAccountFlags(oid, account);
    } catch (e) {
      this.logger.warn(
        `Stripe Connect refresh skipped for user ${oid.toString()}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  async listBalanceTransactions(
    connectAccountId: string,
    opts: { limit?: number; startingAfter?: string },
  ) {
    const id = connectAccountId.trim();
    if (!id) {
      throw new BadRequestException('stripe_account_required');
    }
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    const startingAfter = opts.startingAfter?.trim();
    return this.stripe().balanceTransactions.list(
      {
        limit,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: id },
    );
  }

  /** Vendeur ou livreur approuvé (versements Stripe Connect sur le compte utilisateur). */
  private assertConnectRecipient(user: UserModel) {
    if (
      user.type !== UserTypeEnum.VENDOR &&
      user.type !== UserTypeEnum.DELIVERY
    ) {
      throw new ForbiddenException('connect_recipient_only');
    }
  }

  private userId(user: UserModel): Types.ObjectId {
    const raw =
      (user as UserModel & { _id?: Types.ObjectId | string })._id ?? user.id;
    if (raw instanceof Types.ObjectId) return raw;
    return new Types.ObjectId(String(raw));
  }

  /**
   * Site web affiché sur l’onboarding Stripe (« Business website »).
   * `DASHBOARD_BASE_URL` (ex. https://afrikan-meals.com) — même variable que les liens vendeur.
   */
  private resolveConnectBusinessWebsiteUrl(): string | undefined {
    const raw =
      this.config.get<string>('DASHBOARD_BASE_URL')?.trim() ||
      this.config.get<string>('STRIPE_CONNECT_BUSINESS_WEBSITE_URL')?.trim() ||
      this.config.get<string>('FRONTEND_URL')?.trim();
    return normalizeStripeBusinessUrl(raw);
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
  private async clearStaleConnectAccount(
    userId: Types.ObjectId,
  ): Promise<void> {
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

  /**
   * Livreur avec compte Express créé en `company` (legacy) : supprime le compte
   * Stripe incomplet et repart sur `individual` à la prochaine création.
   */
  private async resetMisconfiguredDeliveryConnectAccount(
    user: UserModel,
    userId: Types.ObjectId,
    account: StripeConnectAccountRecord,
  ): Promise<boolean> {
    if (user.type !== UserTypeEnum.DELIVERY) return false;
    if (account.business_type === DELIVERY_CONNECT_BUSINESS_TYPE) return false;
    if (isConnectFullyActive(account)) return false;

    const accountId = account.id?.trim();
    if (!accountId) return false;

    this.logger.warn(
      `Resetting delivery Connect account ${accountId} (was business_type=${
        account.business_type ?? 'unknown'
      }) for user ${userId.toString()}`,
    );

    try {
      await this.stripe().accounts.del(accountId);
    } catch (e) {
      this.logger.warn(
        `Stripe Connect account delete skipped for ${accountId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    await this.clearStaleConnectAccount(userId);
    return true;
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

  private async defaultAddressForUser(
    userId: Types.ObjectId,
  ): Promise<AddressModel | null> {
    const doc = await this.userModel
      .findById(userId)
      .populate<{ addresses: AddressModel[] }>('addresses')
      .lean()
      .exec();
    const list = doc?.addresses;
    if (!Array.isArray(list) || list.length === 0) return null;
    const picked =
      list.find((a) => a && typeof a === 'object' && a.isDefault) ?? list[0];
    return picked && typeof picked === 'object' ? picked : null;
  }

  private async resolveConnectPrefillContext(user: UserModel): Promise<{
    store: (StoreModel & { address?: AddressModel }) | null;
    userAddress: AddressModel | null;
  }> {
    const uid = this.userId(user);
    const store = await this.primaryStoreForVendor(uid);
    const userAddress =
      user.type === UserTypeEnum.DELIVERY && !store
        ? await this.defaultAddressForUser(uid)
        : null;
    return { store, userAddress };
  }

  private buildPrefillForUser(
    user: UserModel,
    store: (StoreModel & { address?: AddressModel }) | null,
    userAddress: AddressModel | null,
  ): ConnectPrefill {
    return buildVendorPrefill(
      user,
      store,
      this.resolveConnectBusinessWebsiteUrl(),
      userAddress,
    );
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

  /**
   * Comptes Express : après création, Stripe n’autorise plus que
   * `business_profile` (pas `company`, `email`, `business_type`).
   * Ces champs sont envoyés uniquement à `accounts.create`.
   */
  private buildExpressSafeUpdateBody(
    prefill: ConnectPrefill,
  ): Record<string, unknown> {
    return {
      business_profile: prefill.business_profile,
    };
  }

  /** Représentant légal (comptes `company` uniquement). */
  private async syncRepresentativePerson(
    accountId: string,
    prefill: ConnectPrefill,
  ): Promise<void> {
    if (prefill.businessType !== VENDOR_CONNECT_BUSINESS_TYPE) return;
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
        await stripe.accounts.updatePerson(
          accountId,
          current.id,
          personPayload,
        );
      } else {
        await stripe.accounts.createPerson(accountId, personPayload);
      }
    } catch (e) {
      this.logger.warn(
        `Stripe Connect representative person skipped for ${accountId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /** Pousse société, site web et adresse sur Stripe avant l’Account Link. */
  private async flushPrefillBeforeOnboardingLink(
    accountId: string,
    account: StripeConnectAccountRecord,
    user: UserModel,
    store: (StoreModel & { address?: AddressModel }) | null,
    userAddress: AddressModel | null,
  ): Promise<void> {
    const prefill = this.buildPrefillForUser(user, store, userAddress);
    const websiteUrl = prefill.business_profile.url as string | undefined;
    if (!websiteUrl) {
      this.logger.warn(
        'Stripe Connect: set DASHBOARD_BASE_URL in API .env to prefill Business website',
      );
    }
    await this.stripe().accounts.update(
      accountId,
      this.buildExpressSafeUpdateBody(prefill),
    );
    // Persons API souvent indisponible sur Express — adresse société via onboarding Stripe.
    const addr = prefill.company.address as StripeAddressBlock | undefined;
    this.logger.log(
      `Stripe Connect prefill flushed for ${accountId} (website=${
        websiteUrl ?? 'none'
      }, province=${addr?.state ?? 'n/a'})`,
    );
  }

  private async syncPrefillToAccount(
    accountId: string,
    account: StripeConnectAccountRecord,
    user: UserModel,
    store: (StoreModel & { address?: AddressModel }) | null,
    userAddress: AddressModel | null,
  ): Promise<StripeConnectAccountRecord> {
    if (isConnectFullyActive(account)) {
      return account;
    }
    try {
      await this.flushPrefillBeforeOnboardingLink(
        accountId,
        account,
        user,
        store,
        userAddress,
      );
      const refreshed = (await this.stripe().accounts.retrieve(
        accountId,
      )) as StripeConnectAccountRecord;
      return refreshed;
    } catch (e) {
      this.logger.warn(
        `Stripe Connect prefill update skipped: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return account;
    }
  }

  private statusFromAccount(
    account: StripeConnectAccountRecord | null,
    user?: UserModel,
  ): StripeConnectStatus {
    const defaultBusinessType = user
      ? resolveConnectBusinessType(user)
      : VENDOR_CONNECT_BUSINESS_TYPE;
    if (!account) {
      return {
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        onboardingComplete: false,
        status: 'not_created',
        businessType: defaultBusinessType,
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
      businessType:
        account.business_type === DELIVERY_CONNECT_BUSINESS_TYPE ||
        account.business_type === VENDOR_CONNECT_BUSINESS_TYPE
          ? account.business_type
          : defaultBusinessType,
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
  async handleAccountUpdated(
    account: StripeConnectAccountRecord,
  ): Promise<void> {
    const accountId = account.id;
    const user = await this.userModel
      .findOne({ stripeConnectAccountId: accountId })
      .exec();
    if (!user) return;
    const uid = this.userId(user);
    await this.syncAccountFlags(uid, account);
    const status = this.statusFromAccount(account, user);
    this.pushConnectStatusRealtime(uid, status);
    this.logger.log(
      `Stripe Connect account.updated synced for user ${uid} (status=${status.status})`,
    );
  }

  async getConnectStatus(user: UserModel): Promise<StripeConnectStatus> {
    this.assertConnectRecipient(user);
    const uid = this.userId(user);
    const doc = await this.userModel
      .findById(uid)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue email fullName phoneNumber',
      )
      .exec();
    const accountId = doc?.stripeConnectAccountId?.trim() || null;
    if (!accountId) {
      return this.statusFromAccount(null, user);
    }
    try {
      const account = await this.stripe().accounts.retrieve(accountId);
      await this.syncAccountFlags(uid, account);
      return this.statusFromAccount(account, user);
    } catch (e) {
      this.logger.warn(
        `Stripe account retrieve failed for ${accountId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(uid);
        const reset = this.statusFromAccount(null, user);
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
      return this.statusFromAccount(cachedAccount, user);
    }
  }

  async createOnboardingLink(
    user: UserModel,
  ): Promise<{ url: string; accountId: string }> {
    this.assertConnectRecipient(user);
    const uid = this.userId(user);
    const { store, userAddress } = await this.resolveConnectPrefillContext(
      user,
    );
    const stripe = this.stripe();
    const { returnUrl, refreshUrl } = this.connectReturnUrls();
    const prefill = this.buildPrefillForUser(user, store, userAddress);

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
        if (
          account &&
          (await this.resetMisconfiguredDeliveryConnectAccount(
            user,
            uid,
            account,
          ))
        ) {
          accountId = undefined;
          account = null;
        }
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
        const createBody: Record<string, unknown> = {
          type: 'express',
          country: prefill.accountCountry,
          email: user.email?.trim(),
          business_type: prefill.businessType,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            platform: 'africa-meals',
            userId: uid.toString(),
            recipientRole:
              prefill.businessType === DELIVERY_CONNECT_BUSINESS_TYPE
                ? 'delivery'
                : 'vendor',
          },
          business_profile: prefill.business_profile,
        };
        if (prefill.businessType === VENDOR_CONNECT_BUSINESS_TYPE) {
          createBody.company = prefill.company;
        } else if (prefill.individual) {
          createBody.individual = prefill.individual;
        }
        account = (await stripe.accounts.create(
          createBody,
        )) as StripeConnectAccountRecord;
        accountId = account.id;
        if (prefill.businessType === VENDOR_CONNECT_BUSINESS_TYPE) {
          await this.syncRepresentativePerson(accountId, prefill);
        }
        await this.syncAccountFlags(uid, account);
      } catch (createErr) {
        this.logger.error(
          `Stripe Connect account create failed: ${
            createErr instanceof Error ? createErr.message : String(createErr)
          }`,
        );
        throw new BadRequestException(userFacingStripeConnectError(createErr));
      }
    } else if (account) {
      account = await this.syncPrefillToAccount(
        accountId,
        account,
        user,
        store,
        userAddress,
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
      await this.flushPrefillBeforeOnboardingLink(
        accountId,
        account,
        user,
        store,
        userAddress,
      );
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

  /** Mise à jour légère autorisée sur Express (sans Persons API). */
  private async syncBusinessProfileOnly(
    accountId: string,
    user: UserModel,
    store: (StoreModel & { address?: AddressModel }) | null,
    userAddress: AddressModel | null,
  ): Promise<void> {
    const prefill = this.buildPrefillForUser(user, store, userAddress);
    try {
      await this.stripe().accounts.update(
        accountId,
        this.buildExpressSafeUpdateBody(prefill),
      );
    } catch (e) {
      this.logger.warn(
        `Stripe Connect business_profile sync skipped: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  async createDashboardLink(
    user: UserModel,
  ): Promise<{ url: string; status: 'complete' | 'incomplete' }> {
    this.assertConnectRecipient(user);
    const uid = this.userId(user);
    const accountId = (
      await this.userModel.findById(uid).select('stripeConnectAccountId').lean()
    )?.stripeConnectAccountId?.trim();
    if (!accountId) {
      throw new BadRequestException('stripe_connect_not_linked');
    }

    const { store, userAddress } = await this.resolveConnectPrefillContext(
      user,
    );
    const stripe = this.stripe();
    const { returnUrl, refreshUrl } = this.connectReturnUrls();

    let account: StripeConnectAccountRecord;
    try {
      account = (await stripe.accounts.retrieve(
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
      await this.syncBusinessProfileOnly(accountId, user, store, userAddress);
      account = (await stripe.accounts.retrieve(
        accountId,
      )) as StripeConnectAccountRecord;
      await this.syncAccountFlags(uid, account);

      const canOpenExpressDashboard =
        Boolean(account.details_submitted) &&
        (isConnectFullyActive(account) ||
          Boolean(account.charges_enabled) ||
          Boolean(account.payouts_enabled));

      if (canOpenExpressDashboard) {
        try {
          const login = await stripe.accounts.createLoginLink(accountId);
          if (login.url) {
            this.logger.log(
              `Stripe Express login link created for ${accountId}`,
            );
            return { url: login.url, status: 'complete' };
          }
        } catch (loginErr) {
          this.logger.warn(
            `Stripe Express login link unavailable for ${accountId}: ${
              loginErr instanceof Error ? loginErr.message : String(loginErr)
            }`,
          );
        }
      }

      const linkType: 'account_onboarding' | 'account_update' =
        account.details_submitted ? 'account_update' : 'account_onboarding';

      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: linkType,
        collect: 'eventually_due',
      });
      if (!link.url) {
        throw new BadRequestException('stripe_onboarding_link_failed');
      }
      this.logger.log(
        `Stripe ${linkType} link for dashboard (incomplete) account ${accountId}`,
      );
      return { url: link.url, status: 'incomplete' };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(uid);
        throw new BadRequestException('stripe_connect_account_unavailable');
      }
      this.logger.error(
        `Stripe dashboard link failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw new BadRequestException('stripe_dashboard_link_failed');
    }
  }

  async listPayouts(
    user: UserModel,
    limit = 25,
    startingAfter?: string,
  ): Promise<{ payouts: StripeConnectPayoutRow[]; hasMore: boolean }> {
    this.assertConnectRecipient(user);
    const status = await this.getConnectStatus(user);
    if (!status.accountId) {
      return { payouts: [], hasMore: false };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const uid = this.userId(user);
    let list;
    try {
      const listParams: { limit: number; starting_after?: string } = {
        limit: safeLimit,
      };
      const cursor = startingAfter?.trim();
      if (cursor) {
        listParams.starting_after = cursor;
      }
      list = await this.stripe().payouts.list(listParams, {
        stripeAccount: status.accountId,
      });
    } catch (e) {
      this.logger.warn(
        `Stripe payouts list failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
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

  async getConnectBalance(user: UserModel): Promise<StripeConnectBalance> {
    this.assertConnectRecipient(user);
    const status = await this.getConnectStatus(user);
    if (!status.accountId || !status.payoutsEnabled) {
      return { available: 0, pending: 0, currency: 'CAD' };
    }
    const currency = (status.defaultCurrency ?? 'cad').toLowerCase();
    try {
      const balance = await this.stripe().balance.retrieve(
        {},
        { stripeAccount: status.accountId },
      );
      const pick = (rows: { amount?: number; currency?: string }[]) =>
        rows.find((b) => b.currency === currency) ??
        rows.find((b) => b.currency === 'cad') ??
        rows[0];
      const avail = pick(balance.available ?? []);
      const pend = pick(balance.pending ?? []);
      return {
        available: (avail?.amount ?? 0) / 100,
        pending: (pend?.amount ?? 0) / 100,
        currency: (avail?.currency ?? currency).toUpperCase(),
      };
    } catch (e) {
      this.logger.warn(
        `Stripe balance retrieve failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(this.userId(user));
      }
      return { available: 0, pending: 0, currency: currency.toUpperCase() };
    }
  }

  async getPayoutEstimate(
    user: UserModel,
  ): Promise<StripeConnectPayoutEstimate> {
    this.assertConnectRecipient(user);
    const status = await this.getConnectStatus(user);
    const currency = (status.defaultCurrency ?? 'cad').toLowerCase();
    if (
      !status.accountId ||
      !status.payoutsEnabled ||
      !status.onboardingComplete
    ) {
      return {
        available: 0,
        payoutFee: 0,
        netPayout: 0,
        currency: currency.toUpperCase(),
        feeMode: 'fixed',
        feePercent: 0,
        feeFixed: 0,
        canRequestPayout: false,
      };
    }

    let availableCents = 0;
    let payoutCurrency = currency;
    try {
      const balance = await this.stripe().balance.retrieve(
        {},
        { stripeAccount: status.accountId },
      );
      const row = balanceAvailableRow(balance, currency);
      availableCents = row?.amount ?? 0;
      payoutCurrency = row?.currency ?? currency;
    } catch {
      return {
        available: 0,
        payoutFee: 0,
        netPayout: 0,
        currency: currency.toUpperCase(),
        feeMode: 'fixed',
        feePercent: 0,
        feeFixed: 0,
        canRequestPayout: false,
      };
    }

    const split = await this.platformFees.computePayoutFeeFromSettings(
      availableCents,
    );
    const payoutFeeCents = Math.max(0, split.platformFeeCents);
    const netPayoutCents = Math.max(0, split.payoutCents);

    return {
      available: availableCents / 100,
      payoutFee: payoutFeeCents / 100,
      netPayout: netPayoutCents / 100,
      currency: payoutCurrency.toUpperCase(),
      feeMode: split.feeMode,
      feePercent: split.feePercent,
      feeFixed: split.feeFixedCad,
      canRequestPayout: netPayoutCents >= 100,
    };
  }

  /**
   * Versement manuel du solde disponible vers le compte bancaire du vendeur (Express).
   */
  async requestPayout(user: UserModel): Promise<StripeConnectPayoutRow> {
    this.assertConnectRecipient(user);
    const uid = this.userId(user);
    const status = await this.getConnectStatus(user);
    if (!status.accountId) {
      throw new BadRequestException('stripe_connect_not_linked');
    }
    if (!status.payoutsEnabled || !status.onboardingComplete) {
      throw new BadRequestException('stripe_payouts_not_enabled');
    }

    const accountId = status.accountId;
    const currency = (status.defaultCurrency ?? 'cad').toLowerCase();

    let availableCents = 0;
    let payoutCurrency = currency;
    try {
      const balance = await this.stripe().balance.retrieve(
        {},
        { stripeAccount: accountId },
      );
      const row = balanceAvailableRow(balance, currency);
      availableCents = row?.amount ?? 0;
      payoutCurrency = row?.currency ?? currency;
    } catch (e) {
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(uid);
        throw new BadRequestException('stripe_connect_account_unavailable');
      }
      throw new BadRequestException('stripe_balance_unavailable');
    }

    if (availableCents < 100) {
      throw new BadRequestException('stripe_payout_no_balance');
    }

    const payoutSplit = await this.platformFees.computePayoutFeeFromSettings(
      availableCents,
    );
    const payoutFeeCents = Math.max(0, payoutSplit.platformFeeCents);
    const payoutCents = Math.max(0, payoutSplit.payoutCents);
    if (payoutCents < 100) {
      throw new BadRequestException('stripe_payout_no_balance_after_fee');
    }

    try {
      const payout = await this.stripe().payouts.create(
        {
          amount: payoutCents,
          currency: payoutCurrency,
          description: 'Versement demandé depuis Afrika Meals',
          metadata: {
            platformPayoutFeeCents: String(payoutFeeCents),
            platformPayoutFeeMode: payoutSplit.feeMode,
            platformPayoutFeePercent: String(payoutSplit.feePercent),
            platformPayoutFeeFixed: String(payoutSplit.feeFixedCad),
          },
        },
        { stripeAccount: accountId },
      );
      this.logger.log(
        `Stripe manual payout ${payout.id} for ${accountId}: gross=${
          availableCents / 100
        } ${currency}, fee=${payoutFeeCents / 100}, net=${payoutCents / 100}`,
      );
      return {
        id: payout.id,
        amount: (payout.amount ?? payoutCents) / 100,
        currency: String(payout.currency ?? currency).toUpperCase(),
        status: payout.status ?? 'pending',
        arrivalDate: payout.arrival_date
          ? new Date(payout.arrival_date * 1000).toISOString()
          : null,
        createdAt: new Date((payout.created ?? 0) * 1000).toISOString(),
        method: payout.method ?? 'standard',
        description: payout.description ?? null,
      };
    } catch (e) {
      this.logger.error(
        `Stripe payout create failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      if (isStripeConnectAccountUnavailableError(e)) {
        await this.clearStaleConnectAccount(uid);
        throw new BadRequestException('stripe_connect_account_unavailable');
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (/insufficient/i.test(msg)) {
        throw new BadRequestException('stripe_payout_no_balance');
      }
      throw new BadRequestException('stripe_payout_request_failed');
    }
  }
}

function balanceAvailableRow(
  balance: { available?: { amount?: number; currency?: string }[] },
  currency: string,
): { amount?: number; currency?: string } | undefined {
  return (
    balance.available?.find((b) => b.currency === currency) ??
    balance.available?.find((b) => b.currency === 'cad') ??
    balance.available?.[0]
  );
}
