/** Périodes supportées pour Gain Estimate (P&L plateforme). */
export type GainEstimatePeriodKey = '7d' | '30d' | '90d';

export type GainEstimateVerdict = 'profit' | 'loss' | 'break_even';

export type GainEstimateAiSource = 'llm' | 'heuristic';

export type GainEstimateBreakdownKey =
  | 'order_commission'
  | 'order_payment_fee'
  | 'vendor_subscriptions'
  | 'partner_subscriptions'
  | 'ad_credit'
  | 'sms_paid'
  | 'sms_pending'
  | 'payout_fees'
  | 'stripe_processing';

export interface GainEstimateBreakdownRow {
  key: GainEstimateBreakdownKey;
  label: string;
  /** Montant en CAD (positif = revenu ou coût selon side). */
  amountCad: number;
  side: 'revenue' | 'cost';
  /** true si estimation (ex. payout fees sans ledger). */
  estimated?: boolean;
}

export interface GainEstimatePlanSnapshot {
  vendorActiveCount: number;
  partnerActiveCount: number;
  vendorAvgPricePaidCad: number;
  partnerAvgPricePaidCad: number;
  vendorCatalogAvgMonthlyCad: number;
  partnerCatalogAvgMonthlyCad: number;
}

export interface GainEstimateFeeConfigSnapshot {
  orderCommissionMode: string;
  orderCommissionFixed: number;
  orderCommissionPercent: number;
  orderPaymentFeeMode: string;
  orderPaymentFeeFixed: number;
  orderPaymentFeePercent: number;
  payoutFeeMode: string;
  payoutFeeFixed: number;
  payoutFeePercent: number;
}

export interface GainEstimateAiBlock {
  source: GainEstimateAiSource;
  summary: string;
  suggestions: string[];
}

export interface GainEstimatePayload {
  period: {
    key: GainEstimatePeriodKey;
    from: string;
    to: string;
    timezone: string;
  };
  currency: 'CAD';
  totals: {
    revenueCad: number;
    costCad: number;
    netCad: number;
    verdict: GainEstimateVerdict;
  };
  breakdown: GainEstimateBreakdownRow[];
  planSnapshot: GainEstimatePlanSnapshot;
  feeConfigSnapshot: GainEstimateFeeConfigSnapshot;
  ai: GainEstimateAiBlock;
  /** Montants non convertis (devise hors taux). */
  unconverted?: Array<{ currency: string; amountMajor: number; source: string }>;
}

/** Entrées brutes pour construire le P&L (testable sans Mongo). */
export interface GainEstimateRawInputs {
  orderCommissionCad: number;
  orderPaymentFeeCad: number;
  vendorSubscriptionsCad: number;
  partnerSubscriptionsCad: number;
  adCreditCad: number;
  smsPaidCad: number;
  smsPendingCad: number;
  payoutFeesCad: number;
  payoutFeesEstimated: boolean;
  stripeProcessingCad: number;
  planSnapshot: GainEstimatePlanSnapshot;
  feeConfigSnapshot: GainEstimateFeeConfigSnapshot;
  locale: 'fr' | 'en';
}
