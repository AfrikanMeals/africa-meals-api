/**
 * Agrégation dashboard Partner — pure (sans Mongo / Stripe).
 * Entrées = DTOs déjà sérialisés (earnings, referrers, sub, connect, inbox).
 */

import type {
  PartnerEarningListItemDto,
  PartnerEarningListTotalsDto,
  PartnerEarningTotalsByCurrencyDto,
} from './partner-earning-list.util';
import {
  computePartnerEarningTotalsByCurrency,
  normalizePartnerDisplayCurrency,
} from './partner-earning-list.util';
import type {
  PartnerReferrerRowDto,
  PartnerReferrersBundleDto,
} from './partner-referrers-list.util';

export type PartnerDashboardActivityKind =
  | 'earning'
  | 'referrer'
  | 'notification';

export type PartnerDashboardActivityItemDto = {
  id: string;
  kind: PartnerDashboardActivityKind;
  at: string;
  title: string;
  subtitle?: string;
  amount?: number;
  currency?: string;
  hrefHint?: string;
};

export type PartnerDashboardSubscriptionDto = {
  status: string;
  planName: string;
  endsAt: string | null;
  trialEndsAt: string | null;
  isTrial: boolean;
};

export type PartnerDashboardConnectDto = {
  ready: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingComplete: boolean;
};

export type PartnerDashboardReferrersCountsDto = {
  customer: number;
  vendor: number;
  courier: number;
  total: number;
};

export type PartnerDashboardEarningsSummaryDto = PartnerEarningListTotalsDto & {
  /** Devise d’affichage Partner (région d’exercice), pas celle du 1er earning. */
  currency: string;
  /** Totaux natifs par devise ledger — à convertir côté client vers `currency`. */
  totalsByCurrency: PartnerEarningTotalsByCurrencyDto[];
};

export type PartnerDashboardSummaryDto = {
  /** Région tarifaire résolue (appCountry → candidature). */
  pricingRegion: string | null;
  subscription: PartnerDashboardSubscriptionDto | null;
  connect: PartnerDashboardConnectDto;
  referrers: PartnerDashboardReferrersCountsDto;
  earnings: PartnerDashboardEarningsSummaryDto;
  recentEarnings: PartnerEarningListItemDto[];
  recentReferrers: PartnerReferrerRowDto[];
  recentActivity: PartnerDashboardActivityItemDto[];
};

/** Types inbox Partner (alignés mobile `partner_inbox_filter.dart`). */
export const PARTNER_DASHBOARD_INBOX_TYPES = [
  'partner_profile_review',
  'partner_referral_code_changed',
  'partner_subscription_changed',
  'partner_subscription_expired',
  'partner_subscription_trial_reminder',
] as const;

export type PartnerDashboardInboxLean = {
  id: string;
  type?: string;
  title?: string;
  body?: string;
  createdAt?: string | null;
};

const DEFAULT_CURRENCY = 'CAD';
const RECENT_EARNINGS_LIMIT = 8;
const RECENT_REFERRERS_LIMIT = 8;
const ACTIVITY_LIMIT = 12;

function parseAt(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Devise d’affichage KPI : région Partner d’abord, sinon 1er earning, sinon CAD.
 * Fix: Partner CM ne doit plus voir CAD par défaut via le 1er ledger CA.
 */
export function partnerDashboardDisplayCurrency(args: {
  displayCurrency?: string | null;
  items: PartnerEarningListItemDto[];
}): string {
  const fromRegion = normalizePartnerDisplayCurrency(args.displayCurrency);
  if (args.displayCurrency && fromRegion) return fromRegion;
  const c = String(args.items[0]?.currency ?? '')
    .trim()
    .toUpperCase();
  return c || DEFAULT_CURRENCY;
}

/** @deprecated utiliser partnerDashboardDisplayCurrency */
export function partnerDashboardDominantCurrency(
  items: PartnerEarningListItemDto[],
): string {
  return partnerDashboardDisplayCurrency({ items });
}

/** Compteurs filleuls depuis le bundle referrers. */
export function partnerDashboardReferrerCounts(
  bundle: PartnerReferrersBundleDto,
): PartnerDashboardReferrersCountsDto {
  const customer = bundle.customer.referrers.length;
  const vendor = bundle.vendor.referrers.length;
  const courier = bundle.courier.referrers.length;
  return { customer, vendor, courier, total: customer + vendor + courier };
}

/** Fusionne les 3 tabs → liste unique triée par date desc. */
export function partnerDashboardRecentReferrers(
  bundle: PartnerReferrersBundleDto,
  limit = RECENT_REFERRERS_LIMIT,
): PartnerReferrerRowDto[] {
  const all = [
    ...bundle.customer.referrers,
    ...bundle.vendor.referrers,
    ...bundle.courier.referrers,
  ];
  all.sort((a, b) => parseAt(b.referredAt) - parseAt(a.referredAt));
  return all.slice(0, Math.max(0, limit));
}

export function isPartnerDashboardInboxType(
  type: string | null | undefined,
): boolean {
  const t = String(type ?? '')
    .trim()
    .toLowerCase();
  return (PARTNER_DASHBOARD_INBOX_TYPES as readonly string[]).includes(t);
}

function hrefHintForInboxType(type: string): string | undefined {
  const t = type.trim().toLowerCase();
  if (t === 'partner_referral_code_changed') return 'referral';
  if (
    t === 'partner_subscription_changed' ||
    t === 'partner_subscription_expired' ||
    t === 'partner_subscription_trial_reminder'
  ) {
    return 'subscription';
  }
  if (t === 'partner_profile_review') return 'profile';
  return undefined;
}

function axisLabel(axis: string): string {
  switch (axis) {
    case 'customer_order':
      return 'Customer orders';
    case 'vendor_sales':
      return 'Store sales';
    case 'courier_gains':
      return 'Courier earnings';
    default:
      return axis || 'Commission';
  }
}

/**
 * Timeline unifiée : gains + filleuls + notifs Partner, tri desc, cap.
 */
export function buildPartnerDashboardActivity(args: {
  recentEarnings: PartnerEarningListItemDto[];
  recentReferrers: PartnerReferrerRowDto[];
  inbox: PartnerDashboardInboxLean[];
  limit?: number;
}): PartnerDashboardActivityItemDto[] {
  const items: PartnerDashboardActivityItemDto[] = [];

  for (const e of args.recentEarnings) {
    if (!e.id || !e.createdAt) continue;
    items.push({
      id: `earning:${e.id}`,
      kind: 'earning',
      at: e.createdAt,
      title: axisLabel(e.axis),
      subtitle: e.status,
      amount: e.commissionAmount,
      currency: e.currency,
      hrefHint: 'finance',
    });
  }

  for (const r of args.recentReferrers) {
    if (!r.id || !r.referredAt) continue;
    items.push({
      id: `referrer:${r.id}`,
      kind: 'referrer',
      at: r.referredAt,
      title: r.fullName,
      subtitle: r.type || undefined,
      hrefHint: 'referrers',
    });
  }

  for (const n of args.inbox) {
    if (!n.id || !isPartnerDashboardInboxType(n.type)) continue;
    const at = n.createdAt?.trim() || '';
    if (!at) continue;
    const type = String(n.type ?? '');
    items.push({
      id: `notification:${n.id}`,
      kind: 'notification',
      at,
      title: String(n.title ?? '').trim() || 'Notification',
      subtitle: String(n.body ?? '').trim() || undefined,
      hrefHint: hrefHintForInboxType(type),
    });
  }

  items.sort((a, b) => parseAt(b.at) - parseAt(a.at));
  const lim = args.limit ?? ACTIVITY_LIMIT;
  return items.slice(0, Math.max(0, lim));
}

export function mapPartnerDashboardConnect(status: {
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  onboardingComplete?: boolean;
}): PartnerDashboardConnectDto {
  const chargesEnabled = status.chargesEnabled === true;
  const payoutsEnabled = status.payoutsEnabled === true;
  const onboardingComplete = status.onboardingComplete === true;
  // Prêt à recevoir des versements Partner.
  const ready = onboardingComplete && payoutsEnabled;
  return { ready, chargesEnabled, payoutsEnabled, onboardingComplete };
}

export function mapPartnerDashboardSubscription(
  active: {
    status?: string;
    planName?: string;
    endsAt?: unknown;
    trialEndsAt?: unknown;
    isTrial?: boolean;
  } | null,
): PartnerDashboardSubscriptionDto | null {
  if (!active) return null;
  const toIso = (raw: unknown): string | null => {
    if (raw == null) return null;
    if (typeof raw === 'string') {
      const t = Date.parse(raw);
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    }
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      return raw.toISOString();
    }
    return null;
  };
  return {
    status: String(active.status ?? '').trim().toUpperCase(),
    planName: String(active.planName ?? '').trim(),
    endsAt: toIso(active.endsAt),
    trialEndsAt: toIso(active.trialEndsAt),
    isTrial: active.isTrial === true,
  };
}

/**
 * Assemble le payload `GET partner/dashboard`.
 */
export function buildPartnerDashboardSummary(args: {
  earningsItems: PartnerEarningListItemDto[];
  earningsTotals: PartnerEarningListTotalsDto;
  referrersBundle: PartnerReferrersBundleDto;
  subscriptionActive: {
    status?: string;
    planName?: string;
    endsAt?: unknown;
    trialEndsAt?: unknown;
    isTrial?: boolean;
  } | null;
  connectStatus: {
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    onboardingComplete?: boolean;
  };
  inbox: PartnerDashboardInboxLean[];
  /** Devise région Partner (SupportedCountries). */
  displayCurrency?: string | null;
  pricingRegion?: string | null;
}): PartnerDashboardSummaryDto {
  const recentEarnings = args.earningsItems.slice(0, RECENT_EARNINGS_LIMIT);
  const recentReferrers = partnerDashboardRecentReferrers(
    args.referrersBundle,
    RECENT_REFERRERS_LIMIT,
  );
  const currency = partnerDashboardDisplayCurrency({
    displayCurrency: args.displayCurrency,
    items: args.earningsItems,
  });
  const pricingRegion = args.pricingRegion
    ? String(args.pricingRegion).trim().toUpperCase() || null
    : null;
  return {
    pricingRegion,
    subscription: mapPartnerDashboardSubscription(args.subscriptionActive),
    connect: mapPartnerDashboardConnect(args.connectStatus),
    referrers: partnerDashboardReferrerCounts(args.referrersBundle),
    earnings: {
      ...args.earningsTotals,
      currency,
      totalsByCurrency: computePartnerEarningTotalsByCurrency(
        args.earningsItems,
      ),
    },
    recentEarnings,
    recentReferrers,
    recentActivity: buildPartnerDashboardActivity({
      recentEarnings,
      recentReferrers,
      inbox: args.inbox,
    }),
  };
}
