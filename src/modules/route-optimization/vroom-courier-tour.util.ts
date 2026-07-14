/**
 * Parse / types — tournée livreur multi-stops (VROOM vs Directions Google seul).
 * Ex. Pickup A → Pickup B → Deliver A → Deliver B.
 */

import type { VroomLngLat, VroomSolution } from './vroom-problem.util';

export type CourierTourStopKind = 'pickup' | 'delivery';

export type CourierTourStop = {
  orderId: string;
  kind: CourierTourStopKind;
  longitude: number;
  latitude: number;
  sequence: number;
};

export type CourierTourResult = {
  stops: CourierTourStop[];
  durationSeconds: number | null;
  distanceMeters: number | null;
};

/**
 * Extrait la séquence optimale depuis `routes[0].steps` VROOM.
 * Descriptions attendues : `{orderId}:pickup` / `{orderId}:delivery`.
 */
export function parseCourierTourStopsFromVroomSolution(
  solution: VroomSolution,
  shipmentMeta: Array<{
    orderId: string;
    pickup: VroomLngLat;
    delivery: VroomLngLat;
  }>,
): CourierTourResult | null {
  if (solution.code != null && solution.code !== 0) return null;
  const route = solution.routes?.[0];
  if (!route?.steps?.length) return null;

  const byOrder = new Map(
    shipmentMeta.map((s) => [s.orderId, s] as const),
  );
  const stops: CourierTourStop[] = [];
  let seq = 0;

  for (const step of route.steps) {
    const type = String(step.type ?? '').toLowerCase();
    if (type !== 'pickup' && type !== 'delivery') continue;

    const desc = String(step.description ?? '');
    const colon = desc.lastIndexOf(':');
    let orderId = '';
    let kind: CourierTourStopKind | null = null;
    if (colon > 0) {
      const suffix = desc.slice(colon + 1).toLowerCase();
      if (suffix === 'pickup' || suffix === 'delivery') {
        orderId = desc.slice(0, colon).trim();
        kind = suffix;
      }
    }
    if (!kind) {
      kind = type as CourierTourStopKind;
      // Fallback id shipment VROOM : pickup = 2k, delivery = 2k+1
      const rawId = Number(step.id);
      if (Number.isFinite(rawId)) {
        const shipmentId = Math.floor(rawId / 2);
        const meta = shipmentMeta[shipmentId - 1];
        if (meta) orderId = meta.orderId;
      }
    }
    if (!orderId || !kind) continue;
    const meta = byOrder.get(orderId);
    const lngLat =
      kind === 'pickup' ? meta?.pickup : meta?.delivery;
    if (!lngLat) continue;
    stops.push({
      orderId,
      kind,
      longitude: lngLat[0],
      latitude: lngLat[1],
      sequence: seq++,
    });
  }

  if (stops.length === 0) return null;

  return {
    stops,
    durationSeconds:
      route.duration != null && Number.isFinite(route.duration)
        ? Math.max(0, Math.round(route.duration))
        : null,
    distanceMeters:
      route.distance != null && Number.isFinite(route.distance)
        ? Math.max(0, Math.round(route.distance))
        : null,
  };
}

/**
 * Fallback naïf si VROOM off : tous les pickups puis tous les deliveries
 * (même boutiques regroupées approximativement).
 */
export function naiveBatchTourStops(
  shipments: Array<{
    orderId: string;
    pickup: VroomLngLat;
    delivery: VroomLngLat;
  }>,
): CourierTourStop[] {
  const stops: CourierTourStop[] = [];
  let seq = 0;
  for (const s of shipments) {
    stops.push({
      orderId: s.orderId,
      kind: 'pickup',
      longitude: s.pickup[0],
      latitude: s.pickup[1],
      sequence: seq++,
    });
  }
  for (const s of shipments) {
    stops.push({
      orderId: s.orderId,
      kind: 'delivery',
      longitude: s.delivery[0],
      latitude: s.delivery[1],
      sequence: seq++,
    });
  }
  return stops;
}
