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
            exec: jest
              .fn()
              .mockResolvedValue(overrides?.store ?? null),
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
    expect((membershipDoc as { inviteToken?: string }).inviteToken).toBeUndefined();
    expect((membershipDoc as { respondedAt?: Date }).respondedAt).toBeInstanceOf(
      Date,
    );
    expect(notifyPartnerLeft).toHaveBeenCalledWith(
      expect.objectContaining({
        courierUserId: String(courierUser._id),
        storeName: 'Le Cameroun',
        vendorUserId: '507f1f77bcf86cd799439014',
      }),
    );
  });
});
