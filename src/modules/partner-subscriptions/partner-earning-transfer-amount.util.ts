/**
 * Montant / devise Stripe pour un transfer commission Partner.
 * Aligné Connect vendeur : si le ledger est en XAF mais le solde plateforme
 * n’a que du CAD (settlement), convertir via le taux charge → BT.
 */
import { convertChargeMinorToSettlementMinor } from '@modules/billing/stripe/stripe-charge-settlement-fx.util';
import {
  normalizeStripeCurrencyCode,
  toStripeMinorUnits,
} from '@utils/stripe-currency-amount.util';

export type PlatformBalanceRow = {
  currency: string;
  amountMinor: number;
};

export type PartnerEarningTransferSpec =
  | {
      ok: true;
      amountMinor: number;
      currency: string;
      mode: 'ledger' | 'settlement_fx';
    }
  | { ok: false; reason: string };

/** Solde disponible plateforme pour une devise (unités mineures Stripe). */
export function pickPlatformAvailableMinor(
  rows: PlatformBalanceRow[],
  currency: string,
): number {
  const cur = normalizeStripeCurrencyCode(currency).toLowerCase();
  const row = rows.find(
    (r) => normalizeStripeCurrencyCode(r.currency).toLowerCase() === cur,
  );
  return Math.max(0, Math.round(Number(row?.amountMinor) || 0));
}

/**
 * Extrait l’orderId depuis `sourceId` (`{orderId}:vendor_sales`).
 * Valide un ObjectId Mongo 24 hex.
 */
export function parsePartnerEarningOrderId(sourceId: string): string | null {
  const head = String(sourceId ?? '')
    .trim()
    .split(':')[0]
    ?.trim();
  if (!head || !/^[a-fA-F0-9]{24}$/.test(head)) return null;
  return head;
}

/**
 * Choisit ledger currency si solde OK, sinon settlement + FX (ex. XAF → CAD).
 */
export function resolvePartnerEarningTransferSpec(args: {
  ledgerAmountMajor: number;
  ledgerCurrency: string;
  platformAvailable: PlatformBalanceRow[];
  settlementCurrency: string;
  /** Taux unités mineures ledger → settlement (Stripe `exchange_rate`). */
  ledgerToSettlementRate?: number | null;
}): PartnerEarningTransferSpec {
  const ledgerCurrency = normalizeStripeCurrencyCode(args.ledgerCurrency);
  const ledgerMinor = toStripeMinorUnits(
    Number(args.ledgerAmountMajor) || 0,
    ledgerCurrency,
  );
  if (ledgerMinor < 1) {
    return { ok: false, reason: 'partner_earning_amount_zero' };
  }

  const ledgerAvail = pickPlatformAvailableMinor(
    args.platformAvailable,
    ledgerCurrency,
  );
  // 1. Préférer la devise ledger (ex. XAF top-up test, ou CA en CAD).
  if (ledgerAvail >= ledgerMinor) {
    return {
      ok: true,
      amountMinor: ledgerMinor,
      currency: ledgerCurrency.toLowerCase(),
      mode: 'ledger',
    };
  }

  const settlementCurrency = normalizeStripeCurrencyCode(
    args.settlementCurrency,
  );
  // Même devise : pas de FX possible — solde insuffisant.
  if (settlementCurrency === ledgerCurrency) {
    return { ok: false, reason: 'partner_earning_insufficient_balance' };
  }

  const rate = Number(args.ledgerToSettlementRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, reason: 'partner_earning_fx_required' };
  }
  // rate=1 entre devises différentes = BT manquant / fallback dangereux.
  if (rate === 1) {
    return { ok: false, reason: 'partner_earning_fx_required' };
  }

  const settlementMinor = convertChargeMinorToSettlementMinor(ledgerMinor, {
    exchangeRate: rate,
  });
  if (settlementMinor < 1) {
    return { ok: false, reason: 'partner_earning_settlement_amount_zero' };
  }

  const settlementAvail = pickPlatformAvailableMinor(
    args.platformAvailable,
    settlementCurrency,
  );
  if (settlementAvail < settlementMinor) {
    return { ok: false, reason: 'partner_earning_insufficient_settlement' };
  }

  return {
    ok: true,
    amountMinor: settlementMinor,
    currency: settlementCurrency.toLowerCase(),
    mode: 'settlement_fx',
  };
}
