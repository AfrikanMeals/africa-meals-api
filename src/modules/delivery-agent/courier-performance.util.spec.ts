import {
  acceptanceDispatchPenalty,
  computeCourierAcceptanceRate,
  computeCourierPerformanceLevel,
  computeCourierPerformanceScore,
  computeCourierRejectionRate,
  deriveCourierPerformance,
  performanceDispatchPenalty,
} from './courier-performance.util';
import {
  buildCourierStatusPerformanceOverview,
  maskStripeAccountId,
  projectCourierStatusPerformanceForVendor,
} from './courier-status-performance.util';

describe('courier-performance.util', () => {
  it('acceptanceRate null without samples', () => {
    expect(computeCourierAcceptanceRate({})).toBeNull();
  });

  it('acceptanceRate counts offers + marketplace', () => {
    expect(
      computeCourierAcceptanceRate({
        offersAccepted: 2,
        offersRejected: 1,
        offersExpired: 1,
        marketplaceClaims: 2,
        marketplaceMissed: 0,
      }),
    ).toBe(0.667);
  });

  it('performanceScore defaults to 70 for new courier', () => {
    expect(computeCourierPerformanceScore({})).toBe(70);
  });

  it('keeps a notified offer neutral until the courier decides', () => {
    expect(
      computeCourierPerformanceScore({
        offersPresented: 1,
        marketplaceNotified: 1,
      }),
    ).toBe(70);
  });

  it('performanceScore rises with acceptance and completions', () => {
    const score = computeCourierPerformanceScore({
      offersAccepted: 8,
      offersRejected: 1,
      offersExpired: 1,
      completedDeliveries: 10,
      unassignByCourier: 0,
    });
    expect(score).toBeGreaterThan(70);
  });

  it('performanceScore drops with abandons', () => {
    const good = computeCourierPerformanceScore({
      offersAccepted: 5,
      offersRejected: 0,
      completedDeliveries: 5,
      unassignByCourier: 0,
    });
    const bad = computeCourierPerformanceScore({
      offersAccepted: 5,
      offersRejected: 0,
      completedDeliveries: 5,
      unassignByCourier: 5,
    });
    expect(bad).toBeLessThan(good);
  });

  it('deriveCourierPerformance averages duration and distance', () => {
    const d = deriveCourierPerformance({
      offersAccepted: 1,
      completedDeliveries: 2,
      totalDeliveryDurationSec: 3600,
      totalDistanceKm: 10,
    });
    expect(d.avgDeliveryDurationSec).toBe(1800);
    expect(d.avgDistanceKm).toBe(5);
    expect(d.performanceScore).toBeGreaterThan(0);
  });

  it('dispatch penalties scale with weak metrics', () => {
    expect(performanceDispatchPenalty(100)).toBe(0);
    expect(performanceDispatchPenalty(0)).toBe(25);
    expect(acceptanceDispatchPenalty(1)).toBe(0);
    expect(acceptanceDispatchPenalty(0)).toBe(20);
    expect(acceptanceDispatchPenalty(null)).toBe(0);
  });

  it('performanceLevel thresholds', () => {
    expect(computeCourierPerformanceLevel(90)).toBe('excellent');
    expect(computeCourierPerformanceLevel(70)).toBe('good');
    expect(computeCourierPerformanceLevel(69)).toBe('needs_improvement');
  });

  it('rejectionRate shares acceptance denominator', () => {
    expect(
      computeCourierRejectionRate({
        offersAccepted: 2,
        offersRejected: 2,
        offersExpired: 0,
        marketplaceClaims: 0,
        marketplaceMissed: 0,
      }),
    ).toBe(0.5);
    expect(computeCourierRejectionRate({})).toBeNull();
  });
});

describe('courier-status-performance.util', () => {
  it('masks stripe account and omits financials for vendor', () => {
    expect(maskStripeAccountId('acct_1234567890abcd')).toBe('acct_****abcd');
    const overview = buildCourierStatusPerformanceOverview({
      userId: 'u1',
      applicationId: 'a1',
      displayName: 'Test',
      applicationStatus: 'APPROVED',
      partnerBadge: null,
      presence: {
        availability: 'disponible',
        presence: 'disponible',
        activeOrderCount: 0,
        maxConcurrentOrders: 2,
      },
      stripe: {
        onboardingComplete: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        accountId: 'acct_1234567890abcd',
      },
      counters: { offersAccepted: 1, completedDeliveries: 1, totalDistanceKm: 3 },
      averageRating: 4.5,
      ratingCount: 2,
      includeFinancials: false,
      financials: {
        ordersDeliveredTotal: 10,
        shippingRevenueTotal: 100,
        driverEarningTotal: 50,
        driverTipEarningTotal: 5,
        currency: 'CAD',
      },
      maskStripeAccountId: true,
    });
    expect(overview.financials).toBeUndefined();
    expect(overview.status.stripe.accountId).toBe('acct_****abcd');
    expect(overview.performance.performanceLevel).toBeTruthy();
  });

  it('includes financials for admin', () => {
    const overview = buildCourierStatusPerformanceOverview({
      userId: 'u1',
      applicationId: 'a1',
      displayName: 'Test',
      applicationStatus: 'APPROVED',
      partnerBadge: null,
      presence: null,
      stripe: null,
      counters: {},
      averageRating: null,
      ratingCount: 0,
      includeFinancials: true,
      financials: {
        ordersDeliveredTotal: 1,
        shippingRevenueTotal: 10,
        driverEarningTotal: 5,
        driverTipEarningTotal: 0,
        currency: 'XAF',
      },
    });
    expect(overview.financials?.driverEarningTotal).toBe(5);
  });

  it('clamps invalid public counters and allowlists the vendor payload', () => {
    const overview = buildCourierStatusPerformanceOverview({
      userId: 'u1',
      applicationId: 'a1',
      displayName: 'Test',
      applicationStatus: 'APPROVED',
      partnerBadge: null,
      presence: null,
      stripe: null,
      counters: {
        completedDeliveries: -2,
        totalDistanceKm: Number.POSITIVE_INFINITY,
      },
      averageRating: null,
      ratingCount: 0,
      includeFinancials: true,
      financials: {
        ordersDeliveredTotal: 1,
        shippingRevenueTotal: 10,
        driverEarningTotal: 5,
        driverTipEarningTotal: 0,
        currency: 'XAF',
      },
    });

    const vendor = projectCourierStatusPerformanceForVendor(overview);

    expect(vendor.performance.completedDeliveries).toBe(0);
    expect(vendor.performance.totalDistanceKm).toBe(0);
    expect('financials' in vendor).toBe(false);
  });
});
