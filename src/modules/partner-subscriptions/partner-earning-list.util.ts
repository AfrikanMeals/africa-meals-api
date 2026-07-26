/**
 * Sérialisation liste gains affiliation Partner (finance mobile).
 * Isolé du service pour tests anti-régression sans Mongo/Stripe.
 */

export type PartnerEarningListLean = {
  _id?: { toString(): string } | string;
  axis?: string;
  sourceType?: string;
  sourceId?: string;
  regionCode?: string;
  baseAmount?: number;
  commissionAmount?: number;
  currency?: string;
  status?: string;
  stripeTransferId?: string;
  failureReason?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type PartnerEarningListItemDto = {
  id: string;
  axis: string;
  sourceType: string;
  sourceId: string;
  regionCode: string;
  baseAmount: number;
  commissionAmount: number;
  currency: string;
  status: string;
  stripeTransferId: string;
  failureReason: string;
  createdAt: string | null;
};

export type PartnerEarningListTotalsDto = {
  commissionAmount: number;
  transferredAmount: number;
  pendingAmount: number;
  count: number;
};

/** Normalise un montant ledger (NaN / négatif → 0). */
export function normalizePartnerEarningAmount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** ISO date ou null si invalide. */
export function partnerEarningDateIso(raw: unknown): string | null {
  if (raw == null) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Mappe un doc lean → DTO liste finance.
 * Précondition : doc affilié au partner courant (filtre service).
 */
export function mapPartnerEarningToListItem(
  doc: PartnerEarningListLean,
): PartnerEarningListItemDto {
  const id =
    doc._id == null
      ? ''
      : typeof doc._id === 'string'
        ? doc._id
        : String(doc._id.toString());
  return {
    id,
    axis: String(doc.axis ?? '').trim(),
    sourceType: String(doc.sourceType ?? '').trim(),
    sourceId: String(doc.sourceId ?? '').trim(),
    regionCode: String(doc.regionCode ?? '')
      .trim()
      .toUpperCase(),
    baseAmount: normalizePartnerEarningAmount(doc.baseAmount),
    commissionAmount: normalizePartnerEarningAmount(doc.commissionAmount),
    currency: String(doc.currency ?? 'CAD')
      .trim()
      .toUpperCase() || 'CAD',
    status: String(doc.status ?? 'PENDING').trim().toUpperCase(),
    stripeTransferId: String(doc.stripeTransferId ?? '').trim(),
    failureReason: String(doc.failureReason ?? '').trim(),
    createdAt: partnerEarningDateIso(doc.createdAt),
  };
}

/** Totaux pour bandeau onglet Commissions (somme commissions par statut). */
export function computePartnerEarningListTotals(
  items: PartnerEarningListItemDto[],
): PartnerEarningListTotalsDto {
  let commissionAmount = 0;
  let transferredAmount = 0;
  let pendingAmount = 0;
  for (const row of items) {
    const amt = normalizePartnerEarningAmount(row.commissionAmount);
    commissionAmount += amt;
    if (row.status === 'TRANSFERRED') transferredAmount += amt;
    else if (row.status === 'PENDING') pendingAmount += amt;
  }
  return {
    commissionAmount,
    transferredAmount,
    pendingAmount,
    count: items.length,
  };
}
