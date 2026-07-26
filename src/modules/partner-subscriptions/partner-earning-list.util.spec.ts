import {
  computePartnerEarningListTotals,
  computePartnerEarningTotalsByCurrency,
  mapPartnerEarningToListItem,
  normalizePartnerDisplayCurrency,
  normalizePartnerEarningAmount,
  partnerEarningDateIso,
} from './partner-earning-list.util';

describe('partner-earning-list.util', () => {
  it('normalizePartnerEarningAmount — NaN / négatif → 0', () => {
    expect(normalizePartnerEarningAmount(12.5)).toBe(12.5);
    expect(normalizePartnerEarningAmount('3')).toBe(3);
    expect(normalizePartnerEarningAmount(-1)).toBe(0);
    expect(normalizePartnerEarningAmount('x')).toBe(0);
  });

  it('mapPartnerEarningToListItem — champs + devise uppercase', () => {
    const item = mapPartnerEarningToListItem({
      _id: { toString: () => 'abc123' },
      axis: 'customer_order',
      sourceType: 'order',
      sourceId: 'ord1',
      regionCode: 'cm',
      baseAmount: 100,
      commissionAmount: 10,
      currency: 'xaf',
      status: 'transferred',
      stripeTransferId: 'tr_1',
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
    });
    expect(item.id).toBe('abc123');
    expect(item.regionCode).toBe('CM');
    expect(item.currency).toBe('XAF');
    expect(item.status).toBe('TRANSFERRED');
    expect(item.commissionAmount).toBe(10);
    expect(item.createdAt).toBe('2026-07-01T12:00:00.000Z');
  });

  it('computePartnerEarningListTotals — pending vs transferred', () => {
    const totals = computePartnerEarningListTotals([
      {
        id: '1',
        axis: 'customer_order',
        sourceType: 'order',
        sourceId: 'a',
        regionCode: 'CA',
        baseAmount: 50,
        commissionAmount: 5,
        currency: 'CAD',
        status: 'PENDING',
        stripeTransferId: '',
        failureReason: '',
        createdAt: null,
      },
      {
        id: '2',
        axis: 'vendor_sales',
        sourceType: 'order',
        sourceId: 'b',
        regionCode: 'CA',
        baseAmount: 80,
        commissionAmount: 8,
        currency: 'CAD',
        status: 'TRANSFERRED',
        stripeTransferId: 'tr_x',
        failureReason: '',
        createdAt: null,
      },
    ]);
    expect(totals.count).toBe(2);
    expect(totals.commissionAmount).toBe(13);
    expect(totals.pendingAmount).toBe(5);
    expect(totals.transferredAmount).toBe(8);
  });

  it('partnerEarningDateIso — invalide → null', () => {
    expect(partnerEarningDateIso('not-a-date')).toBeNull();
    expect(partnerEarningDateIso(null)).toBeNull();
  });

  it('computePartnerEarningTotalsByCurrency — buckets CAD / XAF', () => {
    const rows = computePartnerEarningTotalsByCurrency([
      {
        id: '1',
        axis: 'customer_order',
        sourceType: 'order',
        sourceId: 'a',
        regionCode: 'CA',
        baseAmount: 50,
        commissionAmount: 5,
        currency: 'CAD',
        status: 'PENDING',
        stripeTransferId: '',
        failureReason: '',
        createdAt: null,
      },
      {
        id: '2',
        axis: 'vendor_sales',
        sourceType: 'order',
        sourceId: 'b',
        regionCode: 'CM',
        baseAmount: 1000,
        commissionAmount: 100,
        currency: 'XAF',
        status: 'TRANSFERRED',
        stripeTransferId: 'tr_x',
        failureReason: '',
        createdAt: null,
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.currency === 'CAD')?.pendingAmount).toBe(5);
    expect(rows.find((r) => r.currency === 'XAF')?.transferredAmount).toBe(100);
  });

  it('normalizePartnerDisplayCurrency', () => {
    expect(normalizePartnerDisplayCurrency('xaf')).toBe('XAF');
    expect(normalizePartnerDisplayCurrency('')).toBe('CAD');
  });
});
