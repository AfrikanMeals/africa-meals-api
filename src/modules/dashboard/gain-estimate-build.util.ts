import type {
  GainEstimateBreakdownRow,
  GainEstimatePayload,
  GainEstimateRawInputs,
  GainEstimateVerdict,
} from './gain-estimate.types';

/** Seuil ±1 CAD = break-even (bruit d’arrondi / FX). */
export const GAIN_ESTIMATE_BREAK_EVEN_ABS_CAD = 1;

/** Arrondi affichage CAD (2 décimales). */
export function roundCad(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Verdict P&L selon net CAD. */
export function resolveGainEstimateVerdict(
  netCad: number,
  breakEvenAbs = GAIN_ESTIMATE_BREAK_EVEN_ABS_CAD,
): GainEstimateVerdict {
  const n = roundCad(netCad);
  if (Math.abs(n) <= breakEvenAbs) return 'break_even';
  return n > 0 ? 'profit' : 'loss';
}

const LABELS_FR: Record<GainEstimateBreakdownRow['key'], string> = {
  order_commission: 'Commission commandes',
  order_payment_fee: 'Frais de transaction (client)',
  vendor_subscriptions: 'Abonnements vendeurs',
  partner_subscriptions: 'Abonnements partenaires',
  ad_credit: 'Ad Credit encaissé',
  sms_paid: 'SMS vendeur (payés)',
  sms_pending: 'SMS vendeur (dues / pending)',
  payout_fees: 'Frais de versement (payout)',
  stripe_processing: 'Coût traitement Stripe',
};

const LABELS_EN: Record<GainEstimateBreakdownRow['key'], string> = {
  order_commission: 'Order commission',
  order_payment_fee: 'Customer payment fees',
  vendor_subscriptions: 'Vendor subscriptions',
  partner_subscriptions: 'Partner subscriptions',
  ad_credit: 'Ad Credit collected',
  sms_paid: 'Vendor SMS (paid)',
  sms_pending: 'Vendor SMS (due / pending)',
  payout_fees: 'Payout fees',
  stripe_processing: 'Stripe processing cost',
};

/**
 * Construit breakdown + totaux à partir des agrégats bruts.
 * SMS pending = revenu potentiel (inclus dans revenue, marqué).
 */
export function buildGainEstimateFromRaw(
  inputs: GainEstimateRawInputs,
  meta: {
    periodKey: GainEstimatePayload['period']['key'];
    from: string;
    to: string;
    timezone: string;
    unconverted?: GainEstimatePayload['unconverted'];
  },
): Omit<GainEstimatePayload, 'ai'> {
  const labels = inputs.locale === 'en' ? LABELS_EN : LABELS_FR;
  // Typage explicite : sinon TS élargit key/side en string après le filtre.
  const rows: GainEstimateBreakdownRow[] = [
    {
      key: 'order_commission',
      label: labels.order_commission,
      amountCad: roundCad(inputs.orderCommissionCad),
      side: 'revenue',
    },
    {
      key: 'order_payment_fee',
      label: labels.order_payment_fee,
      amountCad: roundCad(inputs.orderPaymentFeeCad),
      side: 'revenue',
    },
    {
      key: 'vendor_subscriptions',
      label: labels.vendor_subscriptions,
      amountCad: roundCad(inputs.vendorSubscriptionsCad),
      side: 'revenue',
    },
    {
      key: 'partner_subscriptions',
      label: labels.partner_subscriptions,
      amountCad: roundCad(inputs.partnerSubscriptionsCad),
      side: 'revenue',
    },
    {
      key: 'ad_credit',
      label: labels.ad_credit,
      amountCad: roundCad(inputs.adCreditCad),
      side: 'revenue',
    },
    {
      key: 'sms_paid',
      label: labels.sms_paid,
      amountCad: roundCad(inputs.smsPaidCad),
      side: 'revenue',
    },
    {
      key: 'sms_pending',
      label: labels.sms_pending,
      amountCad: roundCad(inputs.smsPendingCad),
      side: 'revenue',
      estimated: true,
    },
    {
      key: 'payout_fees',
      label: labels.payout_fees,
      amountCad: roundCad(inputs.payoutFeesCad),
      side: 'revenue',
      estimated: inputs.payoutFeesEstimated,
    },
    {
      key: 'stripe_processing',
      label: labels.stripe_processing,
      amountCad: roundCad(inputs.stripeProcessingCad),
      side: 'cost',
    },
  ];
  const breakdown = rows.filter(
    (row) => row.amountCad !== 0 || row.key === 'stripe_processing',
  );

  const revenueCad = roundCad(
    breakdown
      .filter((r) => r.side === 'revenue')
      .reduce((s, r) => s + r.amountCad, 0),
  );
  const costCad = roundCad(
    breakdown
      .filter((r) => r.side === 'cost')
      .reduce((s, r) => s + r.amountCad, 0),
  );
  const netCad = roundCad(revenueCad - costCad);

  return {
    period: {
      key: meta.periodKey,
      from: meta.from,
      to: meta.to,
      timezone: meta.timezone,
    },
    currency: 'CAD',
    totals: {
      revenueCad,
      costCad,
      netCad,
      verdict: resolveGainEstimateVerdict(netCad),
    },
    breakdown,
    planSnapshot: inputs.planSnapshot,
    feeConfigSnapshot: inputs.feeConfigSnapshot,
    unconverted: meta.unconverted?.length ? meta.unconverted : undefined,
  };
}
