import {
  allocateVroomVehicleIds,
  buildFoodDeliveryVroomProblem,
  isVroomDispatchEnabled,
  rankCouriersFromVroomSolution,
  type VroomSolution,
  type VroomVehicleInput,
} from './vroom-problem.util';
import { deliveryLngLatFromOrder } from './order-delivery-coords.util';

describe('vroom-problem.util', () => {
  it('isVroomDispatchEnabled accepte true/1/on', () => {
    expect(isVroomDispatchEnabled('true')).toBe(true);
    expect(isVroomDispatchEnabled('1')).toBe(true);
    expect(isVroomDispatchEnabled('on')).toBe(true);
    expect(isVroomDispatchEnabled('false')).toBe(false);
    expect(isVroomDispatchEnabled(undefined)).toBe(false);
  });

  it('buildFoodDeliveryVroomProblem : pickup/delivery + capacity', () => {
    const problem = buildFoodDeliveryVroomProblem({
      vehicles: [
        {
          id: 1,
          description: 'agent-a',
          start: [-73.57, 45.5],
          capacitySlots: 2,
        },
        {
          id: 2,
          description: 'agent-b',
          start: [-73.58, 45.51],
          capacitySlots: 0,
        },
      ],
      shipments: [
        {
          shipmentId: 1,
          description: 'ord1',
          pickup: [-73.56, 45.501],
          delivery: [-73.55, 45.502],
        },
      ],
    });
    expect(problem.vehicles).toHaveLength(1);
    expect(problem.vehicles[0].capacity).toEqual([2]);
    expect(problem.shipments).toHaveLength(1);
    expect((problem.shipments[0].pickup as { id: number }).id).toBe(2);
    expect((problem.shipments[0].delivery as { id: number }).id).toBe(3);
    expect(problem.matrices).toBeUndefined();
  });

  it('buildFoodDeliveryVroomProblem avec matrices custom (Mapbox/Google…)', () => {
    const problem = buildFoodDeliveryVroomProblem({
      vehicles: [
        {
          id: 1,
          description: 'agent-a',
          start: [-73.57, 45.5],
          capacitySlots: 1,
        },
      ],
      shipments: [
        {
          shipmentId: 1,
          pickup: [-73.56, 45.5],
          delivery: [-73.55, 45.51],
        },
      ],
      matrices: {
        durations: [
          [0, 100, 200],
          [100, 0, 80],
          [200, 80, 0],
        ],
      },
    });
    expect(problem.vehicles[0].start_index).toBe(0);
    expect(
      (problem.shipments[0].pickup as { location_index: number }).location_index,
    ).toBe(1);
    expect(
      (problem.shipments[0].delivery as { location_index: number })
        .location_index,
    ).toBe(2);
    expect(problem.matrices?.car.durations).toHaveLength(3);
  });

  it('rankCouriersFromVroomSolution : assignés d’abord par durée', () => {
    const vehicles: VroomVehicleInput[] = [
      {
        id: 1,
        description: 'near',
        start: [-73.57, 45.5],
        capacitySlots: 1,
      },
      {
        id: 2,
        description: 'far',
        start: [-73.6, 45.52],
        capacitySlots: 1,
      },
    ];
    const solution: VroomSolution = {
      code: 0,
      routes: [
        { vehicle: 2, duration: 900, distance: 4000 },
        { vehicle: 1, duration: 300, distance: 1200 },
      ],
    };
    const ranked = rankCouriersFromVroomSolution({
      solution,
      vehicles,
      fallbackOrder: ['nogps', 'near', 'far'],
    });
    expect(ranked.map((r) => r.agentUserId)).toEqual([
      'near',
      'far',
      'nogps',
    ]);
    expect(ranked[0].assigned).toBe(true);
    expect(ranked[0].costSeconds).toBe(300);
    expect(ranked[2].assigned).toBe(false);
  });

  it('allocateVroomVehicleIds est 1-indexé stable', () => {
    const m = allocateVroomVehicleIds(['a', 'b']);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
  });
});

describe('order-delivery-coords.util', () => {
  it('lit deliveryAddressSnapshot.coordinates [lng,lat]', () => {
    expect(
      deliveryLngLatFromOrder({
        deliveryAddressSnapshot: {
          location: { coordinates: [-73.5, 45.5] },
        },
      }),
    ).toEqual([-73.5, 45.5]);
  });

  it('repli lat/lng plats', () => {
    expect(
      deliveryLngLatFromOrder({
        shippingAddress: { lat: 45.5, lng: -73.5 },
      }),
    ).toEqual([-73.5, 45.5]);
  });
});
