import {
  naiveBatchTourStops,
  parseCourierTourStopsFromVroomSolution,
} from './vroom-courier-tour.util';
import type { VroomSolution } from './vroom-problem.util';

describe('vroom-courier-tour.util', () => {
  const meta = [
    {
      orderId: 'order-a',
      pickup: [11.5, 3.85] as [number, number],
      delivery: [11.52, 3.86] as [number, number],
    },
    {
      orderId: 'order-b',
      pickup: [11.51, 3.84] as [number, number],
      delivery: [11.53, 3.87] as [number, number],
    },
  ];

  it('parseCourierTourStopsFromVroomSolution — Pickup A/B puis Deliver A/B', () => {
    const solution: VroomSolution = {
      code: 0,
      routes: [
        {
          vehicle: 1,
          duration: 1800,
          distance: 9000,
          steps: [
            { type: 'start' },
            { type: 'pickup', description: 'order-a:pickup', id: 2 },
            { type: 'pickup', description: 'order-b:pickup', id: 4 },
            { type: 'delivery', description: 'order-a:delivery', id: 3 },
            { type: 'delivery', description: 'order-b:delivery', id: 5 },
            { type: 'end' },
          ],
        },
      ],
    };
    const tour = parseCourierTourStopsFromVroomSolution(solution, meta);
    expect(tour).not.toBeNull();
    expect(tour!.stops.map((s) => `${s.kind}:${s.orderId}`)).toEqual([
      'pickup:order-a',
      'pickup:order-b',
      'delivery:order-a',
      'delivery:order-b',
    ]);
    expect(tour!.durationSeconds).toBe(1800);
    expect(tour!.stops[0]!.sequence).toBe(0);
  });

  it('naiveBatchTourStops — pickups puis deliveries', () => {
    const stops = naiveBatchTourStops(meta);
    expect(stops.map((s) => s.kind)).toEqual([
      'pickup',
      'pickup',
      'delivery',
      'delivery',
    ]);
  });
});
