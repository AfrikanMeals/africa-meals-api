import {
  resolveDeliveryMatrixRoutingPlan,
  resolveRoutingEngineForRegion,
} from './map-settings-region.util';
import type { MapSettingsModel } from '@schemas/map-settings.schema';

function baseDoc(
  overrides: Partial<MapSettingsModel> = {},
): MapSettingsModel {
  return {
    key: 'default',
    mobileDeliveryMapboxEnabled: true,
    mobileDeliveryGoogleEnabled: true,
    mobileDeliveryOsmEnabled: true,
    mobileDeliveryRoutingEngine: 'osrm',
    mobileDeliveryRoutingEnginePool: [],
    ...overrides,
  } as MapSettingsModel;
}

describe('resolveDeliveryMatrixRoutingPlan', () => {
  it('pool vide → défaut food delivery OSRM dominant', () => {
    const plan = resolveDeliveryMatrixRoutingPlan(baseDoc());
    expect(plan.preferred).toBe('osrm');
    expect(plan.tryOrder[0]).toBe('osrm');
    expect(plan.pool.some((e) => e.engine === 'osrm')).toBe(true);
  });

  it('poids Admin Mapbox primaires → preferred mapbox', () => {
    const plan = resolveDeliveryMatrixRoutingPlan(
      baseDoc({
        mobileDeliveryRoutingEngine: 'mapbox',
        mobileDeliveryRoutingEnginePool: [
          { engine: 'mapbox', weight: 80 },
          { engine: 'osrm', weight: 15 },
          { engine: 'google_routes', weight: 5 },
        ],
      }),
    );
    expect(plan.preferred).toBe('mapbox');
    expect(plan.tryOrder[0]).toBe('mapbox');
    expect(plan.tryOrder.slice(0, 3)).toEqual([
      'mapbox',
      'osrm',
      'google_routes',
    ]);
  });

  it('resolveRoutingEngineForRegion suit le poids max', () => {
    expect(
      resolveRoutingEngineForRegion(
        baseDoc({
          mobileDeliveryRoutingEnginePool: [
            { engine: 'tomtom', weight: 60 },
            { engine: 'osrm', weight: 40 },
          ],
        }),
        'mobileDelivery',
      ),
    ).toBe('tomtom');
  });
});
