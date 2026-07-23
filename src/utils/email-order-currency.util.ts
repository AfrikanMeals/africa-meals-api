import { isStripeZeroDecimalCurrency } from './stripe-currency-amount.util';

/** Repli ISO3 si getCountryCurrency indisponible (e-mails sync). */
const REGION_CURRENCY_FALLBACK: Record<string, string> = {
  CA: 'CAD',
  CM: 'XAF',
  FR: 'EUR',
  US: 'USD',
  CD: 'CDF',
  MA: 'MAD',
  SN: 'XOF',
  CI: 'XOF',
  BE: 'EUR',
  CH: 'CHF',
};

function normalizeCurrencyCode(raw: unknown): string | null {
  const cur = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(cur) ? cur : null;
}

function normalizeRegionCode(raw: unknown): string | null {
  const cc = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

/**
 * Pays boutique pour devise e-mail : `region` puis adresse (pas téléphone/CAD).
 * Aligné simulateur panier — évite CA via téléphone CA sur magasin CM.
 */
export function resolveStoreRegionCodeForDisplayCurrency(store: {
  region?: unknown;
  address?: { countryCode?: unknown; country_code?: unknown } | null;
}): string | null {
  const fromRegion = normalizeRegionCode(store.region);
  if (fromRegion) return fromRegion;

  const addr = store.address;
  if (!addr || typeof addr !== 'object') return null;
  return (
    normalizeRegionCode(
      (addr as { countryCode?: unknown; country_code?: unknown }).countryCode ??
        (addr as { country_code?: unknown }).country_code,
    ) ?? null
  );
}

/**
 * Devise d’affichage e-mails / reçus commande.
 * Priorité : order (sans CAD legacy hors CA) → devise région API → store → carte ISO → CAD.
 * Pas de conversion FX : les montants commande sont déjà dans la devise boutique.
 */
export function resolveOrderDisplayCurrency(args: {
  orderCurrency?: string | null;
  storeCurrency?: string | null;
  regionCode?: string | null;
  /** Résultat `getCountryCurrency(region)` — prioritaire sur store.currency. */
  regionCurrency?: string | null;
  fallback?: string;
}): string {
  const region = normalizeRegionCode(args.regionCode);

  const fromOrder = normalizeCurrencyCode(args.orderCurrency);
  // Fix: CAD legacy persisté sur commande CM ne doit pas bloquer XAF.
  if (fromOrder && !(fromOrder === 'CAD' && region && region !== 'CA')) {
    return fromOrder;
  }

  const fromRegionApi = normalizeCurrencyCode(args.regionCurrency);
  if (fromRegionApi) return fromRegionApi;

  const fromStore = normalizeCurrencyCode(args.storeCurrency);
  // Fix: CAD legacy sur boutique CM ne doit pas gagner.
  if (fromStore && !(fromStore === 'CAD' && region && region !== 'CA')) {
    return fromStore;
  }

  if (region && REGION_CURRENCY_FALLBACK[region]) {
    return REGION_CURRENCY_FALLBACK[region];
  }

  const fb = normalizeCurrencyCode(args.fallback);
  return fb || 'CAD';
}

/**
 * Montant e-mail / reçu : Intl fr-CA, zero-decimal (XAF) sans centimes.
 */
export function formatEmailMoney(
  amount: number,
  currency?: string | null,
): string {
  const code = resolveOrderDisplayCurrency({ orderCurrency: currency });
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  const zeroDecimal = isStripeZeroDecimalCurrency(code);
  try {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: zeroDecimal ? 0 : 2,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(safe);
  } catch {
    return zeroDecimal
      ? `${Math.round(safe).toLocaleString('fr-CA')} ${code}`
      : `${safe.toFixed(2)} ${code}`;
  }
}
