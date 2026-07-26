import {
  buildPartnerReferrersBundle,
  mapPartnerReferrerRow,
  partnerUserTypeToReferrerTab,
} from './partner-referrers-list.util';

describe('partner-referrers-list.util', () => {
  it('partnerUserTypeToReferrerTab — USER / VENDOR / DELIVERY', () => {
    expect(partnerUserTypeToReferrerTab('USER')).toBe('customer');
    expect(partnerUserTypeToReferrerTab('vendor')).toBe('vendor');
    expect(partnerUserTypeToReferrerTab('DELIVERY')).toBe('courier');
    expect(partnerUserTypeToReferrerTab('PARTNER')).toBeNull();
    expect(partnerUserTypeToReferrerTab('ADMIN')).toBeNull();
  });

  it('mapPartnerReferrerRow — full_name legacy + code upper', () => {
    const row = mapPartnerReferrerRow({
      _id: { toString: () => 'u1' },
      full_name: 'Ada',
      email: 'Ada@Ex.COM',
      type: 'USER',
      referredByPartnerCode: 'ab12cd',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    expect(row).toEqual({
      id: 'u1',
      fullName: 'Ada',
      email: 'ada@ex.com',
      type: 'USER',
      referredAt: '2026-07-01T00:00:00.000Z',
      referralCode: 'AB12CD',
    });
  });

  it('buildPartnerReferrersBundle — tabs + earnings filtrés par axe', () => {
    const bundle = buildPartnerReferrersBundle({
      users: [
        {
          _id: 'c1',
          fullName: 'Client',
          email: 'c@x.com',
          type: 'USER',
          createdAt: '2026-07-02T00:00:00.000Z',
        },
        {
          _id: 'v1',
          fullName: 'Vendor',
          email: 'v@x.com',
          type: 'VENDOR',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        {
          _id: 'd1',
          fullName: 'Courier',
          email: 'd@x.com',
          type: 'DELIVERY',
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      earnings: [
        {
          _id: 'e1',
          axis: 'customer_order',
          commissionAmount: 5,
          status: 'TRANSFERRED',
          currency: 'CAD',
        },
        {
          _id: 'e2',
          axis: 'vendor_sales',
          commissionAmount: 8,
          status: 'PENDING',
          currency: 'CAD',
        },
        {
          _id: 'e3',
          axis: 'courier_gains',
          commissionAmount: 2,
          status: 'TRANSFERRED',
          currency: 'CAD',
        },
      ],
    });
    expect(bundle.customer.referrers).toHaveLength(1);
    expect(bundle.customer.totals.commissionAmount).toBe(5);
    expect(bundle.vendor.referrers[0].fullName).toBe('Vendor');
    expect(bundle.vendor.totals.pendingAmount).toBe(8);
    expect(bundle.courier.earnings).toHaveLength(1);
    expect(bundle.courier.axis).toBe('courier_gains');
  });
});
