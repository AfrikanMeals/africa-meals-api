/**
 * Conversion charge → devise de règlement plateforme (balance_transaction).
 * Obligatoire pour `transfers.create({ source_transaction })` : la devise du
 * transfer doit être celle du balance_transaction, pas celle de la charge.
 */

export type ChargeSettlementFx = {
  /** Devise de la charge client (ex. xaf). */
  chargeCurrency: string;
  /** Devise du solde plateforme (ex. cad). */
  settlementCurrency: string;
  /**
   * Taux charge → settlement (Stripe `balance_transaction.exchange_rate`).
   * 1 si mêmes devises.
   */
  exchangeRate: number;
};

export function normalizeFxCurrency(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase() || 'cad';
}

export function resolveChargeSettlementExchangeRate(args: {
  chargeCurrency: string;
  settlementCurrency: string;
  exchangeRate?: number | null;
  chargeAmountMinor?: number;
  settlementAmountMinor?: number;
}): number {
  const chargeCur = normalizeFxCurrency(args.chargeCurrency);
  const settleCur = normalizeFxCurrency(args.settlementCurrency);
  if (chargeCur === settleCur) return 1;
  const explicit = Number(args.exchangeRate);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const chargeAmt = Math.max(0, Math.round(Number(args.chargeAmountMinor) || 0));
  const settleAmt = Math.max(
    0,
    Math.round(Number(args.settlementAmountMinor) || 0),
  );
  if (chargeAmt > 0 && settleAmt > 0) return settleAmt / chargeAmt;
  return 1;
}

/** Convertit un montant en unités mineures charge → settlement. */
export function convertChargeMinorToSettlementMinor(
  chargeMinor: number,
  fx: Pick<ChargeSettlementFx, 'exchangeRate'>,
): number {
  const amount = Math.max(0, Math.round(Number(chargeMinor) || 0));
  if (amount < 1) return 0;
  const rate =
    Number.isFinite(fx.exchangeRate) && fx.exchangeRate > 0
      ? fx.exchangeRate
      : 1;
  if (rate === 1) return amount;
  return Math.max(0, Math.round(amount * rate));
}
