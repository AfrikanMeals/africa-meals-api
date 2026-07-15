/**
 * Assemblage payload « Performance & Statut » livreur (admin / vendeur / self).
 * Logique pure — pas d’accès DB.
 */
import type { PartnerBadgeSnapshot } from '@common/partner-badges/partner-badge.constants';
import {
  computeCourierPerformanceLevel,
  computeCourierRejectionRate,
  type CourierPerformanceCounters,
  type CourierPerformanceDerived,
  type CourierPerformanceLevel,
  deriveCourierPerformance,
} from './courier-performance.util';

export type CourierStatusPresenceSnapshot = {
  availability: 'disponible' | 'hors_ligne' | string;
  presence: string;
  activeOrderCount: number;
  maxConcurrentOrders: number;
};

export type CourierStatusStripeSnapshot = {
  onboardingComplete: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** Masqué partiellement côté vendor. */
  accountId: string | null;
};

export type CourierStatusPerformanceFinancials = {
  ordersDeliveredTotal: number;
  shippingRevenueTotal: number;
  driverEarningTotal: number;
  driverTipEarningTotal: number;
  currency: string | null;
};

export type CourierStatusPerformanceOverview = {
  userId: string;
  applicationId: string | null;
  displayName: string;
  badge: PartnerBadgeSnapshot | null;
  status: {
    applicationStatus: string;
    presence: CourierStatusPresenceSnapshot | null;
    stripe: CourierStatusStripeSnapshot;
  };
  performance: CourierPerformanceDerived & {
    totalDistanceKm: number;
    completedDeliveries: number;
    rejectionRate: number | null;
    performanceLevel: CourierPerformanceLevel;
    averageRating: number | null;
    ratingCount: number;
  };
  /** Absent pour le vendeur (jamais de gains / balances). */
  financials?: CourierStatusPerformanceFinancials;
};

/** Projection vendeur : le contrat interdit la présence même optionnelle de `financials`. */
export type VendorCourierStatusPerformanceOverview = Omit<
  CourierStatusPerformanceOverview,
  'financials'
>;

export type BuildCourierStatusPerformanceInput = {
  userId: string;
  applicationId: string | null;
  displayName: string;
  applicationStatus: string;
  partnerBadge: PartnerBadgeSnapshot | null;
  presence: CourierStatusPresenceSnapshot | null;
  stripe: {
    onboardingComplete?: boolean;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    accountId?: string | null;
  } | null;
  counters: CourierPerformanceCounters;
  averageRating: number | null;
  ratingCount: number;
  includeFinancials: boolean;
  financials?: CourierStatusPerformanceFinancials | null;
  /** Vendor : masquer l’id Connect complet. */
  maskStripeAccountId?: boolean;
};

/** Masque un accountId Stripe (acct_****abcd). */
export function maskStripeAccountId(accountId: string | null | undefined): string | null {
  const raw = String(accountId ?? '').trim();
  if (!raw) return null;
  if (raw.length <= 8) return '****';
  return `${raw.slice(0, 5)}****${raw.slice(-4)}`;
}

/** Normalise un compteur public pour ne jamais exposer NaN, Infinity ou une valeur négative. */
function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Construit le payload overview.
 * Invariant : si !includeFinancials → jamais de clé `financials`.
 */
export function buildCourierStatusPerformanceOverview(
  input: BuildCourierStatusPerformanceInput,
): CourierStatusPerformanceOverview {
  const derived = deriveCourierPerformance(input.counters);
  const rejectionRate = computeCourierRejectionRate(input.counters);
  const accountRaw = input.stripe?.accountId ?? null;
  const accountId = input.maskStripeAccountId
    ? maskStripeAccountId(accountRaw)
    : accountRaw
      ? String(accountRaw).trim() || null
      : null;

  const overview: CourierStatusPerformanceOverview = {
    userId: input.userId,
    applicationId: input.applicationId,
    displayName: input.displayName,
    badge: input.partnerBadge,
    status: {
      applicationStatus: String(input.applicationStatus ?? '').trim() || 'UNKNOWN',
      presence: input.presence,
      stripe: {
        onboardingComplete: input.stripe?.onboardingComplete === true,
        chargesEnabled: input.stripe?.chargesEnabled === true,
        payoutsEnabled: input.stripe?.payoutsEnabled === true,
        accountId,
      },
    },
    performance: {
      ...derived,
      // Les compteurs Mongo peuvent provenir de documents historiques incomplets.
      totalDistanceKm: nonNegativeNumber(input.counters.totalDistanceKm),
      completedDeliveries: Math.trunc(
        nonNegativeNumber(input.counters.completedDeliveries),
      ),
      rejectionRate,
      performanceLevel: computeCourierPerformanceLevel(derived.performanceScore),
      averageRating: input.averageRating,
      ratingCount: Math.max(0, Math.round(Number(input.ratingCount ?? 0))),
    },
  };

  // Vendeur : ne jamais attacher les gains / revenus.
  if (input.includeFinancials && input.financials) {
    overview.financials = input.financials;
  }

  return overview;
}

/**
 * Reconstruit le payload vendeur par allowlist.
 * Même si l’overview source évolue, aucun champ financier racine ne traverse la route vendeur.
 */
export function projectCourierStatusPerformanceForVendor(
  overview: CourierStatusPerformanceOverview,
): VendorCourierStatusPerformanceOverview {
  return {
    userId: overview.userId,
    applicationId: overview.applicationId,
    displayName: overview.displayName,
    badge: overview.badge,
    status: overview.status,
    performance: overview.performance,
  };
}
