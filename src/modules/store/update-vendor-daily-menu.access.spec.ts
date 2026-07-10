import { NotFoundException } from '@nestjs/common';
import { UserTypeEnum } from '@schemas/user.schema';
import { StoreService } from './store.service';

/**
 * Régression : PATCH daily-menu doit passer par assertStoreAccess
 * (admin / équipe), pas un findOne owner-only → store_not_found.
 */
describe('StoreService.updateVendorDailyMenu access', () => {
  const storeId = '507f1f77bcf86cd799439011';
  const adminUser = {
    _id: 'admin-user-id',
    type: UserTypeEnum.ADMIN,
  } as never;

  function buildService(overrides: {
    assertStoreAccess?: jest.Mock;
    findMyStoreSummary?: jest.Mock;
  }) {
    const assertStoreAccess =
      overrides.assertStoreAccess ?? jest.fn().mockResolvedValue(undefined);
    const findMyStoreSummary =
      overrides.findMyStoreSummary ??
      jest.fn().mockResolvedValue({ store: { id: storeId } });
    const updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ acknowledged: true }),
    });
    const findOne = jest.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc: any = Object.create(StoreService.prototype);
    svc._storeAccess = { assertStoreAccess };
    svc._subscriptionsService = {
      resolveDailyMenuItemLimitForStore: jest.fn().mockResolvedValue(null),
    };
    svc._storeModel = { updateOne, findOne };
    svc._productModel = {
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      }),
    };
    svc._cacheLayer = {
      bustCatalogListing: jest.fn().mockResolvedValue(undefined),
    };
    svc._productCategoryService = {
      invalidatePublicListCache: jest.fn().mockResolvedValue(undefined),
    };
    svc.findMyStoreSummary = findMyStoreSummary;

    return { svc, assertStoreAccess, findMyStoreSummary, updateOne, findOne };
  }

  it('autorise un ADMIN via assertStoreAccess (pas owner-only)', async () => {
    const { svc, assertStoreAccess, findMyStoreSummary, updateOne, findOne } =
      buildService({});

    const result = await svc.updateVendorDailyMenu(storeId, adminUser, []);

    expect(assertStoreAccess).toHaveBeenCalledWith(
      adminUser,
      storeId,
      'catalog.daily_menu.edit',
    );
    expect(findOne).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      { _id: storeId },
      expect.objectContaining({
        $set: expect.objectContaining({
          dailyMenuByWeekday: expect.any(Array),
        }),
      }),
    );
    expect(findMyStoreSummary).toHaveBeenCalledWith(adminUser, storeId);
    expect(result).toEqual({ store: { id: storeId } });
  });

  it('propage store_not_found si assertStoreAccess refuse', async () => {
    const { svc, findMyStoreSummary, updateOne } = buildService({
      assertStoreAccess: jest
        .fn()
        .mockRejectedValue(new NotFoundException('store_not_found')),
    });

    await expect(
      svc.updateVendorDailyMenu(storeId, adminUser, []),
    ).rejects.toThrow('store_not_found');
    expect(updateOne).not.toHaveBeenCalled();
    expect(findMyStoreSummary).not.toHaveBeenCalled();
  });
});
