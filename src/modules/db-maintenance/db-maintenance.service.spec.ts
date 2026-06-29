import { UserTypeEnum } from '@schemas/user.schema';
import { DbMaintenanceService } from './db-maintenance.service';

function queryResult<T>(rows: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(rows),
  };
}

describe('DbMaintenanceService integrity tests', () => {
  const adminUser = { id: 'admin-1', type: UserTypeEnum.ADMIN } as any;

  let service: DbMaintenanceService;
  let storeAccess: { assertAdminPermission: jest.Mock };
  let subscriptionsService: {
    resolveStoreCreationLimitForOwner: jest.Mock;
    resolveCatalogItemLimitForStore: jest.Mock;
    resolvePlanDowngradeImpactForOwner: jest.Mock;
  };
  let storeModel: { find: jest.Mock };
  let productModel: { countDocuments: jest.Mock; find?: jest.Mock };
  let drinkModel: { countDocuments: jest.Mock };
  let adModel: { find: jest.Mock };
  let adCampaignModel: { find: jest.Mock };
  let adNotificationPricingModel: { findOne: jest.Mock };
  let adNotificationEventModel: { aggregate: jest.Mock };
  let couponModel: { find: jest.Mock };
  let cartItemModel: { find: jest.Mock };
  let offerModel: { find: jest.Mock; aggregate?: jest.Mock };
  let recommendationSnapshotModel: { findOne: jest.Mock };
  let userRecommendationDigestModel: { find: jest.Mock };
  let userModel: { find: jest.Mock };
  let infraRuntimeSettingsModel: { findOneAndUpdate: jest.Mock };

  beforeEach(() => {
    storeAccess = {
      assertAdminPermission: jest.fn().mockResolvedValue(undefined),
    };
    subscriptionsService = {
      resolveStoreCreationLimitForOwner: jest.fn(),
      resolveCatalogItemLimitForStore: jest.fn(),
      resolvePlanDowngradeImpactForOwner: jest.fn(),
    };
    storeModel = { find: jest.fn() };
    productModel = { countDocuments: jest.fn() };
    drinkModel = { countDocuments: jest.fn() };
    adModel = { find: jest.fn() };
    adCampaignModel = { find: jest.fn() };
    adNotificationPricingModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          availableChannels: {
            email: true,
            push: true,
            inApp: true,
            sms: true,
            whatsapp: true,
          },
        }),
      }),
    };
    adNotificationEventModel = {
      aggregate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ n: 0 }]),
      }),
    };
    couponModel = { find: jest.fn() };
    cartItemModel = { find: jest.fn() };
    offerModel = { find: jest.fn(), aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };
    recommendationSnapshotModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      }),
    };
    userRecommendationDigestModel = { find: jest.fn().mockReturnValue(queryResult([])) };
    userModel = { find: jest.fn().mockReturnValue(queryResult([])) };
    infraRuntimeSettingsModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          redisManagerEnabled: true,
          mqBrokerEnabled: true,
        }),
      }),
    };

    service = new DbMaintenanceService(
      { db: null } as any,
      { get: jest.fn() } as any,
      storeAccess as any,
      subscriptionsService as any,
      { find: jest.fn(), countDocuments: jest.fn() } as any,
      { find: jest.fn(), countDocuments: jest.fn() } as any,
      storeModel as any,
      productModel as any,
      drinkModel as any,
      adModel as any,
      adCampaignModel as any,
      adNotificationPricingModel as any,
      adNotificationEventModel as any,
      couponModel as any,
      cartItemModel as any,
      offerModel as any,
      recommendationSnapshotModel as any,
      userRecommendationDigestModel as any,
      userModel as any,
      infraRuntimeSettingsModel as any,
      { options: { projectId: 'test-project' } } as any,
      { getMqttStatus: jest.fn() } as any,
      {} as any,
      { getPublicSettings: jest.fn() } as any,
      {
        resolveSmtpFromAddress: jest.fn().mockReturnValue('orders@wise-eat.com'),
        isSmtpConfigured: jest.fn().mockReturnValue(true),
        isEnabled: jest.fn().mockReturnValue(true),
        isShippedEnabled: jest.fn().mockReturnValue(true),
        sendDebugOrderEmail: jest.fn(),
      } as any,
      {} as any,
      {
        resolveString: jest.fn().mockResolvedValue(''),
      } as any,
    );
  });

  it('expose le test de restrictions abonnement dans la liste admin', async () => {
    const out = await service.listIntegrityTests(adminUser);
    expect(
      out.tests.some((t) => t.key === 'subscription-restrictions-test'),
    ).toBe(true);
    expect(
      out.tests.some((t) => t.key === 'subscription-downgrade-impact-test'),
    ).toBe(true);
    expect(out.tests.some((t) => t.key === 'ads-integrity-test')).toBe(true);
    expect(out.tests.some((t) => t.key === 'coupon-codes-integrity-test')).toBe(
      true,
    );
    expect(out.tests.some((t) => t.key === 'cart-features-integrity-test')).toBe(
      true,
    );
    expect(
      out.tests.some((t) => t.key === 'product-recommendations-integrity-test'),
    ).toBe(true);
    expect(out.tests.some((t) => t.key === 'catalog-loading-integrity-test')).toBe(
      true,
    );
    expect(
      out.tests.some((t) => t.key === 'store-detail-page-integrity-test'),
    ).toBe(true);
    expect(
      out.tests.some((t) => t.key === 'platform-readiness-integrity-test'),
    ).toBe(true);
  });

  it('détecte les dépassements quotas boutiques et catalogue par boutique', async () => {
    const owner = '507f1f77bcf86cd799439021';
    const storeA = '507f1f77bcf86cd799439011';
    const storeB = '507f1f77bcf86cd799439012';

    storeModel.find.mockReturnValue(
      queryResult([
        { _id: storeA, owner },
        { _id: storeB, owner },
      ]),
    );
    subscriptionsService.resolveStoreCreationLimitForOwner.mockResolvedValue(1);
    subscriptionsService.resolveCatalogItemLimitForStore.mockResolvedValue(10);

    productModel.countDocuments.mockImplementation(
      (q: { store?: unknown }) => ({
        exec: jest.fn().mockResolvedValue(String(q.store) === storeA ? 10 : 11),
      }),
    );
    drinkModel.countDocuments.mockImplementation(() => ({
      exec: jest.fn().mockResolvedValue(0),
    }));

    const out = await service.runIntegrityTest(
      adminUser,
      'subscription-restrictions-test',
    );

    expect(out.result.key).toBe('subscription-restrictions-test');
    expect(out.result.totalRuns).toBe(3); // 1 owner + 2 stores
    expect(out.result.successRuns).toBe(1); // storeA ok, owner/storeB en échec
    expect(out.result.failureReasonCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'owner_store_limit_exceeded' }),
        expect.objectContaining({ reason: 'store_catalog_limit_exceeded' }),
      ]),
    );
  });

  it('valide un vendeur avec 2 boutiques et 10 éléments par boutique', async () => {
    const owner = '507f1f77bcf86cd799439121';
    const storeA = '507f1f77bcf86cd799439111';
    const storeB = '507f1f77bcf86cd799439112';

    storeModel.find.mockReturnValue(
      queryResult([
        { _id: storeA, owner },
        { _id: storeB, owner },
      ]),
    );
    subscriptionsService.resolveStoreCreationLimitForOwner.mockResolvedValue(2);
    subscriptionsService.resolveCatalogItemLimitForStore.mockResolvedValue(10);

    productModel.countDocuments.mockImplementation(
      (q: { store?: unknown }) => ({
        exec: jest.fn().mockResolvedValue(String(q.store) === storeA ? 9 : 8),
      }),
    );
    drinkModel.countDocuments.mockImplementation((q: { store?: unknown }) => ({
      exec: jest.fn().mockResolvedValue(String(q.store) === storeA ? 1 : 2),
    }));

    const out = await service.runIntegrityTest(
      adminUser,
      'subscription-restrictions-test',
    );

    expect(out.result.totalRuns).toBe(3);
    expect(out.result.successRuns).toBe(3);
    expect(out.result.score).toBe(100);
    expect(out.result.failureReasonCounts).toEqual([]);
  });

  it('détecte les impacts de downgrade (boutiques + catalogue masqués)', async () => {
    const ownerA = '507f1f77bcf86cd799439421';
    const ownerB = '507f1f77bcf86cd799439422';
    storeModel.find.mockReturnValue(
      queryResult([
        { _id: '507f1f77bcf86cd799439411', owner: ownerA },
        { _id: '507f1f77bcf86cd799439412', owner: ownerA },
        { _id: '507f1f77bcf86cd799439413', owner: ownerB },
      ]),
    );
    subscriptionsService.resolvePlanDowngradeImpactForOwner.mockImplementation(
      async (ownerId: string) => {
        if (ownerId === ownerA) {
          return { hiddenStores: 1, hiddenCatalogItems: 5 };
        }
        return { hiddenStores: 0, hiddenCatalogItems: 0 };
      },
    );

    const out = await service.runIntegrityTest(
      adminUser,
      'subscription-downgrade-impact-test',
    );
    expect(out.result.totalRuns).toBe(2);
    expect(out.result.successRuns).toBe(1);
    expect(out.result.failureReasonCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'downgrade_hidden_stores' }),
        expect.objectContaining({ reason: 'downgrade_hidden_catalog_items' }),
      ]),
    );
  });

  it('détecte les anomalies ads (date, cible, store manquant)', async () => {
    const now = Date.now();
    const adStore = '507f1f77bcf86cd799439201';
    adModel.find.mockReturnValue(
      queryResult([
        {
          _id: 'ad-1',
          title: '',
          subtitle: 'Promo flash',
          actionText: 'Voir',
          isActive: true,
          validFrom: new Date(now - 3600_000).toISOString(),
          validUntil: new Date(now - 60_000).toISOString(),
          actionType: 'PRODUCT',
          actionTarget: '',
          store: adStore,
          product: '',
          notificationAddon: { enabled: true, channels: { email: true } },
        },
      ]),
    );
    adCampaignModel.find.mockReturnValue(queryResult([]));
    storeModel.find.mockReturnValue(queryResult([]));
    productModel.find = jest.fn().mockReturnValue(queryResult([]));

    const out = await service.runIntegrityTest(adminUser, 'ads-integrity-test');
    expect(out.result.totalRuns).toBe(3);
    expect(out.result.successRuns).toBe(2);
    expect(out.result.failureReasonCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'missing_ad_title' }),
        expect.objectContaining({ reason: 'active_ad_expired' }),
        expect.objectContaining({ reason: 'ad_store_not_found' }),
      ]),
    );
  });

  it('expose le contrôle santé des canaux notifications Ads', async () => {
    const out = await service.listSystemHealthChecks(adminUser);
    expect(
      out.checks.some((c) => c.key === 'ad-notification-channels-status'),
    ).toBe(true);
    expect(out.checks.some((c) => c.key === 'bird-sms-api-status')).toBe(true);
    expect(out.checks.some((c) => c.key === 'bird-whatsapp-api-status')).toBe(
      true,
    );
  });

  it('détecte les anomalies coupons (format, quota, période)', async () => {
    const storeId = '507f1f77bcf86cd799439301';
    couponModel.find.mockReturnValue(
      queryResult([
        {
          _id: 'cp-1',
          code: 'bad code',
          store: storeId,
          discountType: 'PERCENTAGE',
          value: 150,
          validFrom: '2026-01-05T00:00:00.000Z',
          validUntil: '2026-01-01T00:00:00.000Z',
          enabled: true,
          usedCount: 7,
          maxUses: 5,
        },
      ]),
    );
    storeModel.find.mockReturnValue(queryResult([{ _id: storeId }]));

    const out = await service.runIntegrityTest(
      adminUser,
      'coupon-codes-integrity-test',
    );
    expect(out.result.totalRuns).toBe(1);
    expect(out.result.successRuns).toBe(0);
    expect(out.result.failureReasonCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'coupon_code_invalid_chars' }),
        expect.objectContaining({ reason: 'invalid_percentage_discount' }),
        expect.objectContaining({ reason: 'used_count_exceeds_max_uses' }),
      ]),
    );
  });
});
