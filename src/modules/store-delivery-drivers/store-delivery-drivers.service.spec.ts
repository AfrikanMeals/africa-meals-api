import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StoreDeliveryDriverMembershipStatus } from '@schemas/store-delivery-driver-membership.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { StoreDeliveryDriversService } from './store-delivery-drivers.service';

describe('StoreDeliveryDriversService.leaveActivePartner', () => {
  const courierUser = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    email: 'courier@example.com',
    fullName: 'Jean Livreur',
    type: UserTypeEnum.DELIVERY,
  } as UserModel;

  function buildService(overrides?: {
    membership?: Record<string, unknown> | null;
    store?: Record<string, unknown> | null;
  }) {
    const membershipDoc = overrides?.membership
      ? {
          ...overrides.membership,
          save: jest.fn().mockResolvedValue(undefined),
        }
      : null;

    const notifyPartnerLeft = jest.fn().mockResolvedValue(undefined);

    const service = Object.create(
      StoreDeliveryDriversService.prototype,
    ) as StoreDeliveryDriversService;

    Object.assign(service, {
      _membershipModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(membershipDoc),
        }),
      },
      _storeModel: {
        findById: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(overrides?.store ?? null),
          }),
        }),
      },
      _assertApprovedDeliveryAgentUser: jest.fn().mockResolvedValue(undefined),
      _notifyPartnerLeft: notifyPartnerLeft,
    });

    return { service, membershipDoc, notifyPartnerLeft };
  }

  it('rejects invalid membership id', async () => {
    const { service } = buildService();
    await expect(
      service.leaveActivePartner(courierUser, 'not-an-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when membership is not owned by courier', async () => {
    const { service } = buildService({
      membership: {
        _id: '507f1f77bcf86cd799439012',
        store: '507f1f77bcf86cd799439013',
        user: '507f1f77bcf86cd799439099',
        email: 'other@example.com',
        status: StoreDeliveryDriverMembershipStatus.ACTIVE,
      },
    });

    await expect(
      service.leaveActivePartner(courierUser, '507f1f77bcf86cd799439012'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when membership is not active', async () => {
    const { service } = buildService({
      membership: {
        _id: '507f1f77bcf86cd799439012',
        store: '507f1f77bcf86cd799439013',
        user: String(courierUser._id),
        email: courierUser.email,
        status: StoreDeliveryDriverMembershipStatus.PENDING,
      },
    });

    await expect(
      service.leaveActivePartner(courierUser, '507f1f77bcf86cd799439012'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks membership LEFT and notifies parties', async () => {
    const { service, membershipDoc, notifyPartnerLeft } = buildService({
      membership: {
        _id: '507f1f77bcf86cd799439012',
        store: '507f1f77bcf86cd799439013',
        user: String(courierUser._id),
        email: courierUser.email,
        status: StoreDeliveryDriverMembershipStatus.ACTIVE,
        inviteToken: 'abc',
      },
      store: {
        _id: '507f1f77bcf86cd799439013',
        name: 'Le Cameroun',
        owner: '507f1f77bcf86cd799439014',
        vendorManagesDeliveryDrivers: true,
      },
    });

    const result = await service.leaveActivePartner(
      courierUser,
      '507f1f77bcf86cd799439012',
    );

    expect(result).toEqual({ ok: true });
    expect((membershipDoc as { status?: string }).status).toBe(
      StoreDeliveryDriverMembershipStatus.LEFT,
    );
    expect(
      (membershipDoc as { inviteToken?: string }).inviteToken,
    ).toBeUndefined();
    expect(
      (membershipDoc as { respondedAt?: Date }).respondedAt,
    ).toBeInstanceOf(Date);
    expect(notifyPartnerLeft).toHaveBeenCalledWith(
      expect.objectContaining({
        courierUserId: String(courierUser._id),
        storeName: 'Le Cameroun',
        vendorUserId: '507f1f77bcf86cd799439014',
      }),
    );
  });
});

describe('StoreDeliveryDriversService.getStatusPerformanceForVendor', () => {
  const vendorUser = {
    _id: '507f1f77bcf86cd799439021',
    id: '507f1f77bcf86cd799439021',
    type: UserTypeEnum.VENDOR,
  } as UserModel;
  const membershipId = '507f1f77bcf86cd799439022';
  const storeId = '507f1f77bcf86cd799439023';
  const courierId = '507f1f77bcf86cd799439024';

  /**
   * Monte uniquement les dépendances de lecture de l’overview vendeur.
   * Les mocks gardent visibles les vérifications owner/ACTIVE et l’appel sans finances.
   */
  function buildStatusService(args?: {
    ownerId?: string;
    status?: StoreDeliveryDriverMembershipStatus;
  }) {
    const overview = {
      userId: courierId,
      applicationId: '507f1f77bcf86cd799439025',
      displayName: 'Livreur test',
      badge: null,
      status: {
        applicationStatus: 'APPROVED',
        presence: null,
        stripe: {
          onboardingComplete: true,
          chargesEnabled: true,
          payoutsEnabled: true,
          accountId: 'acct_****abcd',
        },
      },
      performance: {
        acceptanceRate: 1,
        rejectionCount: 0,
        rejectionRate: 0,
        unassignCount: 0,
        avgDeliveryDurationSec: 600,
        avgDistanceKm: 2,
        performanceScore: 90,
        performanceLevel: 'excellent',
        totalDistanceKm: 2,
        completedDeliveries: 1,
        averageRating: 5,
        ratingCount: 1,
      },
      // Simule une régression du builder partagé : la projection vendeur doit la bloquer.
      financials: {
        ordersDeliveredTotal: 1,
        shippingRevenueTotal: 10,
        driverEarningTotal: 5,
        driverTipEarningTotal: 0,
        currency: 'XAF',
      },
    };
    const buildForAgentUserId = jest.fn().mockResolvedValue(overview);
    const service = Object.create(
      StoreDeliveryDriversService.prototype,
    ) as StoreDeliveryDriversService;

    Object.assign(service, {
      _membershipModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: membershipId,
            store: storeId,
            user: courierId,
            status: args?.status ?? StoreDeliveryDriverMembershipStatus.ACTIVE,
          }),
        }),
      },
      _storeModel: {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: storeId,
            owner: args?.ownerId ?? String(vendorUser._id),
          }),
        }),
      },
      _statusPerformance: { buildForAgentUserId },
    });

    return { service, buildForAgentUserId };
  }

  it('refuse un compte admin sur la route vendeur avant toute lecture membership', async () => {
    const { service, buildForAgentUserId } = buildStatusService();
    const admin = {
      _id: '507f1f77bcf86cd799439099',
      type: UserTypeEnum.ADMIN,
    } as UserModel;

    await expect(
      service.getStatusPerformanceForVendor(admin, membershipId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(buildForAgentUserId).not.toHaveBeenCalled();
  });

  it('refuse l’escalade horizontale vers la boutique d’un autre vendeur', async () => {
    const { service, buildForAgentUserId } = buildStatusService({
      ownerId: '507f1f77bcf86cd799439099',
    });

    await expect(
      service.getStatusPerformanceForVendor(vendorUser, membershipId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(buildForAgentUserId).not.toHaveBeenCalled();
  });

  it('exige une membership ACTIVE', async () => {
    const { service, buildForAgentUserId } = buildStatusService({
      status: StoreDeliveryDriverMembershipStatus.PENDING,
    });

    await expect(
      service.getStatusPerformanceForVendor(vendorUser, membershipId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(buildForAgentUserId).not.toHaveBeenCalled();
  });

  it('omet les finances et appelle le builder avec le contrat vendeur', async () => {
    const { service, buildForAgentUserId } = buildStatusService();

    const result = await service.getStatusPerformanceForVendor(
      vendorUser,
      membershipId,
    );

    expect(buildForAgentUserId).toHaveBeenCalledWith(courierId, {
      includeFinancials: false,
      maskStripeAccountId: true,
    });
    expect('financials' in result).toBe(false);
  });
});
