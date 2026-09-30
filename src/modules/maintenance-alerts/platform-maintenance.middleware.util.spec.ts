import { isPlatformMaintenanceWhitelisted } from './platform-maintenance.middleware.util';

describe('isPlatformMaintenanceWhitelisted', () => {
  it('laisse passer la lecture Apps & Contact pendant la maintenance', () => {
    expect(
      isPlatformMaintenanceWhitelisted('/api/platform/mobile-app-settings'),
    ).toBe(true);
    expect(
      isPlatformMaintenanceWhitelisted('/platform/mobile-app-settings'),
    ).toBe(true);
  });

  it('continue de bloquer les routes métier', () => {
    expect(isPlatformMaintenanceWhitelisted('/api/orders')).toBe(false);
    expect(isPlatformMaintenanceWhitelisted('/platform/feature-modules')).toBe(
      false,
    );
  });
});
