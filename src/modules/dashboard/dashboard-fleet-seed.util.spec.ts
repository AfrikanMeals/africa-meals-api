import {
  courierTrackingExtraFromApplication,
  fleetActiveOrderCountFromLivreurRow,
} from './dashboard-fleet-seed.util';

describe('dashboard-fleet-seed.util', () => {
  it('fleetActiveOrderCountFromLivreurRow reflects en_livraison', () => {
    expect(
      fleetActiveOrderCountFromLivreurRow({
        statut: 'en_livraison',
      }),
    ).toBe(1);
    expect(
      fleetActiveOrderCountFromLivreurRow({
        statut: 'disponible',
        commande_en_cours: { id: '#AE-123' },
      }),
    ).toBe(1);
    expect(
      fleetActiveOrderCountFromLivreurRow({ statut: 'disponible' }),
    ).toBe(0);
  });

  it('courierTrackingExtraFromApplication returns coords when valid', () => {
    expect(
      courierTrackingExtraFromApplication({
        lastLatitude: 3.86,
        lastLongitude: 11.51,
      }),
    ).toEqual({
      courierLatitude: 3.86,
      courierLongitude: 11.51,
    });
    expect(courierTrackingExtraFromApplication(null)).toEqual({});
    expect(
      courierTrackingExtraFromApplication({
        lastLatitude: 0,
        lastLongitude: 0,
      }),
    ).toEqual({});
  });
});
