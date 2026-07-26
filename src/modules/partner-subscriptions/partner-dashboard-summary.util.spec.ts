import {
  buildPartnerDashboardActivity,
  buildPartnerDashboardSummary,
  isPartnerDashboardInboxType,
  mapPartnerDashboardConnect,
  partnerDashboardDominantCurrency,
  partnerDashboardReferrerCounts,
  partnerDashboardRecentReferrers,
} from './partner-dashboard-summary.util';
import type { PartnerReferrersBundleDto } from './partner-referrers-list.util';

function emptyTab(
  tab: 'customer' | 'vendor' | 'courier',
  axis: string,
): PartnerReferrersBundleDto['customer'] {
  return {
    tab,
    axis,
    referrers: [],
    earnings: [],
    totals: {
      commissionAmount: 0,
      transferredAmount: 0,
      pendingAmount: 0,
      count: 0,
    },
  };
}

describe('partner-dashboard-summary.util', () => {
  const bundle: PartnerReferrersBundleDto = {
    customer: {
      ...emptyTab('customer', 'customer_order'),
      referrers: [
        {
          id: 'c1',
          fullName: 'Alice',
          email: 'a@x.com',
          type: 'USER',
          referredAt: '2026-07-02T00:00:00.000Z',
          referralCode: 'ABC123',
        },
      ],
    },
    vendor: {
      ...emptyTab('vendor', 'vendor_sales'),
      referrers: [
        {
          id: 'v1',
          fullName: 'Boutique',
          email: 'v@x.com',
          type: 'VENDOR',
          referredAt: '2026-07-03T00:00:00.000Z',
          referralCode: 'ABC123',
        },
      ],
    },
    courier: emptyTab('courier', 'courier_gains'),
  };

  it('referrer counts + recent sorted', () => {
    expect(partnerDashboardReferrerCounts(bundle)).toEqual({
      customer: 1,
      vendor: 1,
      courier: 0,
      total: 2,
    });
    const recent = partnerDashboardRecentReferrers(bundle, 1);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('v1');
  });

  it('dominant currency from first earning', () => {
    expect(partnerDashboardDominantCurrency([])).toBe('CAD');
    expect(
      partnerDashboardDominantCurrency([
        {
          id: 'e1',
          axis: 'vendor_sales',
          sourceType: 'order',
          sourceId: 'o1',
          regionCode: 'CM',
          baseAmount: 1,
          commissionAmount: 1,
          currency: 'xaf',
          status: 'PENDING',
          stripeTransferId: '',
          failureReason: '',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ]),
    ).toBe('XAF');
  });

  it('connect ready = onboarding + payouts', () => {
    expect(
      mapPartnerDashboardConnect({
        onboardingComplete: true,
        payoutsEnabled: true,
        chargesEnabled: true,
      }).ready,
    ).toBe(true);
    expect(
      mapPartnerDashboardConnect({
        onboardingComplete: true,
        payoutsEnabled: false,
      }).ready,
    ).toBe(false);
  });

  it('inbox type filter', () => {
    expect(isPartnerDashboardInboxType('partner_profile_review')).toBe(true);
    expect(isPartnerDashboardInboxType('order_update')).toBe(false);
  });

  it('activity merge sorted desc + cap', () => {
    const activity = buildPartnerDashboardActivity({
      recentEarnings: [
        {
          id: 'e1',
          axis: 'customer_order',
          sourceType: 'order',
          sourceId: 'o1',
          regionCode: 'CA',
          baseAmount: 10,
          commissionAmount: 2,
          currency: 'CAD',
          status: 'PENDING',
          stripeTransferId: '',
          failureReason: '',
          createdAt: '2026-07-01T10:00:00.000Z',
        },
      ],
      recentReferrers: [
        {
          id: 'r1',
          fullName: 'Bob',
          email: 'b@x.com',
          type: 'USER',
          referredAt: '2026-07-02T10:00:00.000Z',
          referralCode: 'X',
        },
      ],
      inbox: [
        {
          id: 'n1',
          type: 'partner_subscription_changed',
          title: 'Plan',
          body: 'ok',
          createdAt: '2026-07-03T10:00:00.000Z',
        },
        {
          id: 'n2',
          type: 'order_update',
          title: 'ignore',
          createdAt: '2026-07-04T10:00:00.000Z',
        },
      ],
      limit: 10,
    });
    expect(activity.map((a) => a.kind)).toEqual([
      'notification',
      'referrer',
      'earning',
    ]);
    expect(activity[0].hrefHint).toBe('subscription');
  });

  it('buildPartnerDashboardSummary wire', () => {
    const summary = buildPartnerDashboardSummary({
      earningsItems: [
        {
          id: 'e1',
          axis: 'vendor_sales',
          sourceType: 'order',
          sourceId: 'o1',
          regionCode: 'CA',
          baseAmount: 100,
          commissionAmount: 8,
          currency: 'CAD',
          status: 'PENDING',
          stripeTransferId: '',
          failureReason: '',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      earningsTotals: {
        commissionAmount: 8,
        transferredAmount: 0,
        pendingAmount: 8,
        count: 1,
      },
      referrersBundle: bundle,
      subscriptionActive: {
        status: 'ACTIVE',
        planName: 'Pro',
        endsAt: '2026-08-01T00:00:00.000Z',
        trialEndsAt: null,
        isTrial: false,
      },
      connectStatus: {
        onboardingComplete: true,
        payoutsEnabled: true,
        chargesEnabled: true,
      },
      inbox: [],
    });
    expect(summary.referrers.total).toBe(2);
    expect(summary.earnings.pendingAmount).toBe(8);
    expect(summary.subscription?.planName).toBe('Pro');
    expect(summary.connect.ready).toBe(true);
    expect(summary.recentEarnings).toHaveLength(1);
  });
});
