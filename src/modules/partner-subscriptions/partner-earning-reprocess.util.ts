/**
 * Règles reprocess commissions affiliation Partner (FAILED → nouvel essai Stripe).
 * Isolé pour tests sans Nest / Stripe.
 */

export type PartnerEarningReprocessOutcome =
  | 'transferred'
  | 'still_failed'
  | 'skipped';

export type PartnerEarningReprocessCounters = {
  attempted: number;
  transferred: number;
  stillFailed: number;
  skipped: number;
};

/**
 * Idempotency Stripe — un crédit par earning + devise transfer.
 * Inclure la devise : un retry XAF→CAD ne doit pas réutiliser la clé failed XAF.
 */
export function partnerEarningTransferIdempotencyKey(
  earningId: string,
  transferCurrency?: string,
): string {
  const id = String(earningId ?? '').trim();
  const cur = String(transferCurrency ?? '')
    .trim()
    .toLowerCase();
  const base = `partner_aff_earning_${id || 'unknown'}`;
  return cur ? `${base}_${cur}` : base;
}

export function isPartnerEarningFailedStatus(
  status: string | null | undefined,
): boolean {
  return String(status ?? '')
    .trim()
    .toUpperCase() === 'FAILED';
}

export function emptyPartnerEarningReprocessCounters(): PartnerEarningReprocessCounters {
  return {
    attempted: 0,
    transferred: 0,
    stillFailed: 0,
    skipped: 0,
  };
}

/** Agrège un résultat unitaire dans les compteurs. */
export function accumulatePartnerEarningReprocessOutcome(
  counters: PartnerEarningReprocessCounters,
  outcome: PartnerEarningReprocessOutcome,
): PartnerEarningReprocessCounters {
  const next = { ...counters, attempted: counters.attempted + 1 };
  if (outcome === 'transferred') next.transferred += 1;
  else if (outcome === 'still_failed') next.stillFailed += 1;
  else next.skipped += 1;
  return next;
}

export function classifyPartnerEarningReprocessOutcome(args: {
  afterStatus: string;
  hadConnectAccount: boolean;
}): PartnerEarningReprocessOutcome {
  if (!args.hadConnectAccount) return 'skipped';
  const st = String(args.afterStatus ?? '')
    .trim()
    .toUpperCase();
  if (st === 'TRANSFERRED') return 'transferred';
  if (st === 'FAILED') return 'still_failed';
  // PENDING = Stripe key absente / gate type — compter skip
  return 'skipped';
}
