import { AuthSettingsService } from './auth-settings.service';

describe('AuthSettingsService cache', () => {
  function makeService(findOneImpl: jest.Mock) {
    const findOneAndUpdate = jest.fn();
    const model = {
      findOne: jest.fn(() => ({
        lean: () => ({
          exec: findOneImpl,
        }),
      })),
      findOneAndUpdate: jest.fn(() => ({
        exec: findOneAndUpdate,
      })),
    };
    const svc = new AuthSettingsService(model as never);
    return { svc, findOne: model.findOne, findOneAndUpdate };
  }

  it('ne relit pas Mongo dans le TTL (2e getPublicSettings)', async () => {
    const doc = {
      key: 'default',
      googleEnabledMobile: true,
      appleEnabledMobile: true,
      facebookEnabledMobile: true,
      googleEnabledAdmin: true,
      appleEnabledAdmin: true,
      facebookEnabledAdmin: true,
      loginEmailNotifyAdminEnabled: true,
      loginEmailNotifyMobileEnabled: true,
    };
    const findOneExec = jest.fn().mockResolvedValue(doc);
    const { svc, findOne } = makeService(findOneExec);

    await svc.getPublicSettings('mobile');
    await svc.getPublicSettings('mobile');
    await svc.assertProviderEnabled('google', 'mobile');

    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('relit Mongo après clearPublicSettingsCache', async () => {
    const doc = {
      key: 'default',
      googleEnabledMobile: true,
      appleEnabledMobile: true,
      facebookEnabledMobile: true,
      googleEnabledAdmin: true,
      appleEnabledAdmin: true,
      facebookEnabledAdmin: true,
      loginEmailNotifyAdminEnabled: true,
      loginEmailNotifyMobileEnabled: true,
    };
    const findOneExec = jest.fn().mockResolvedValue(doc);
    const { svc, findOne } = makeService(findOneExec);

    await svc.getPublicSettings('mobile');
    svc.clearPublicSettingsCache();
    await svc.getPublicSettings('mobile');

    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
