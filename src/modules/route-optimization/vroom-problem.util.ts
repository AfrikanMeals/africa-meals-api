/**
 * Payload / parsing VROOM — Vehicle Routing Open-source Optimization Machine.
 * Coordonnées VROOM : [lon, lat]. Durées en secondes, distances en mètres.
 */

export type VroomLngLat = [number, number];

export type VroomVehicleInput = {
  /** Identifiant stable booké pour VROOM (entier). */
  id: number;
  /** Id métier (ex. agentUserId) — stocké en description. */
  description: string;
  start: VroomLngLat;
  /** Capacité restante (slots commandes). */
  capacitySlots: number;
};

export type VroomShipmentJobInput = {
  /** Id entier shipment (pickup id = id*2, delivery id = id*2+1 dans le builder). */
  shipmentId: number;
  description?: string;
  pickup: VroomLngLat;
  delivery: VroomLngLat;
  /** Quantité (défaut 1 commande). */
  amount?: number;
  priority?: number;
};

export type VroomCustomMatrices = {
  durations: number[][];
  distances?: number[][];
};

export type VroomProblem = {
  vehicles: Array<Record<string, unknown>>;
  shipments: Array<Record<string, unknown>>;
  matrices?: {
    car: {
      durations: number[][];
      distances?: number[][];
    };
  };
};

export type VroomSolutionRoute = {
  vehicle: number;
  duration?: number;
  distance?: number;
  cost?: number;
  steps?: Array<{ type?: string; id?: number; description?: string }>;
};

export type VroomSolution = {
  code?: number;
  error?: string;
  summary?: { duration?: number; distance?: number; cost?: number };
  routes?: VroomSolutionRoute[];
  unassigned?: Array<{ id?: number; type?: string }>;
};

/**
 * Construit un problème VROOM food-delivery : pickup boutique → drop client.
 * Si `matrices` fourni : indices + matrices (Mapbox/Google/HERE/TomTom/OSRM/Valhalla).
 * Sinon : locations pour routeur natif VROOM (OSRM / Valhalla).
 */
export function buildFoodDeliveryVroomProblem(params: {
  vehicles: VroomVehicleInput[];
  shipments: VroomShipmentJobInput[];
  matrices?: VroomCustomMatrices | null;
}): VroomProblem {
  const useMatrix =
    params.matrices != null &&
    Array.isArray(params.matrices.durations) &&
    params.matrices.durations.length > 0;

  const vehiclesFiltered = params.vehicles.filter(
    (v) =>
      Number.isFinite(v.start[0]) &&
      Number.isFinite(v.start[1]) &&
      v.capacitySlots > 0,
  );
  const shipmentsFiltered = params.shipments.filter(
    (s) =>
      Number.isFinite(s.pickup[0]) &&
      Number.isFinite(s.pickup[1]) &&
      Number.isFinite(s.delivery[0]) &&
      Number.isFinite(s.delivery[1]),
  );

  if (!useMatrix) {
    return {
      vehicles: vehiclesFiltered.map((v) => ({
        id: v.id,
        description: v.description,
        start: v.start,
        capacity: [Math.max(1, Math.trunc(v.capacitySlots))],
      })),
      shipments: shipmentsFiltered.map((s) => {
        const amount = Math.max(1, Math.trunc(s.amount ?? 1));
        const base = s.shipmentId * 2;
        return {
          amount: [amount],
          priority: s.priority ?? 0,
          pickup: {
            id: base,
            description: s.description
              ? `${s.description}:pickup`
              : `shipment-${s.shipmentId}-pickup`,
            location: s.pickup,
            service: 120,
          },
          delivery: {
            id: base + 1,
            description: s.description
              ? `${s.description}:delivery`
              : `shipment-${s.shipmentId}-delivery`,
            location: s.delivery,
            service: 180,
          },
        };
      }),
    };
  }

  let index = 0;
  const vehicles = vehiclesFiltered.map((v) => {
    const startIndex = index++;
    return {
      id: v.id,
      description: v.description,
      start_index: startIndex,
      start: v.start,
      capacity: [Math.max(1, Math.trunc(v.capacitySlots))],
    };
  });

  const shipments = shipmentsFiltered.map((s) => {
    const amount = Math.max(1, Math.trunc(s.amount ?? 1));
    const base = s.shipmentId * 2;
    const pickupIndex = index++;
    const deliveryIndex = index++;
    return {
      amount: [amount],
      priority: s.priority ?? 0,
      pickup: {
        id: base,
        description: s.description
          ? `${s.description}:pickup`
          : `shipment-${s.shipmentId}-pickup`,
        location_index: pickupIndex,
        location: s.pickup,
        service: 120,
      },
      delivery: {
        id: base + 1,
        description: s.description
          ? `${s.description}:delivery`
          : `shipment-${s.shipmentId}-delivery`,
        location_index: deliveryIndex,
        location: s.delivery,
        service: 180,
      },
    };
  });

  const matrixSize = index;
  const durations = padOrSliceMatrix(params.matrices!.durations, matrixSize);
  const distances = params.matrices!.distances
    ? padOrSliceMatrix(params.matrices!.distances, matrixSize)
    : undefined;

  return {
    vehicles,
    shipments,
    matrices: {
      car: {
        durations,
        ...(distances ? { distances } : {}),
      },
    },
  };
}

function padOrSliceMatrix(raw: number[][], n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const v = raw[i]?.[j];
      row.push(
        i === j
          ? 0
          : v != null && Number.isFinite(v)
            ? Math.max(0, Math.round(v))
            : 0,
      );
    }
    out.push(row);
  }
  return out;
}

/**
 * Mappe les vehicle ids VROOM → description (agentUserId).
 */
export function mapVroomVehicleIdToDescription(
  vehicles: VroomVehicleInput[],
): Map<number, string> {
  const m = new Map<number, string>();
  for (const v of vehicles) {
    m.set(v.id, v.description);
  }
  return m;
}

export type VroomRankedCourier = {
  agentUserId: string;
  /** Coût / durée VROOM de la tournée assignée (secondes si durée). */
  costSeconds: number | null;
  distanceMeters: number | null;
  assigned: boolean;
};

/**
 * Ordonne les livreurs d’après la solution VROOM (assignés d’abord, coût croissant),
 * puis complete avec les non-assignés dans l’ordre `fallbackOrder`.
 */
export function rankCouriersFromVroomSolution(params: {
  solution: VroomSolution;
  vehicles: VroomVehicleInput[];
  /** Ordre de secours (GEO / haversine) pour non-assignés + sans GPS. */
  fallbackOrder: string[];
}): VroomRankedCourier[] {
  if (params.solution.code != null && params.solution.code !== 0) {
    return params.fallbackOrder.map((agentUserId) => ({
      agentUserId,
      costSeconds: null,
      distanceMeters: null,
      assigned: false,
    }));
  }

  const idToUser = mapVroomVehicleIdToDescription(params.vehicles);
  const assigned = new Map<string, VroomRankedCourier>();

  for (const route of params.solution.routes ?? []) {
    const userId = idToUser.get(route.vehicle);
    if (!userId) continue;
    assigned.set(userId, {
      agentUserId: userId,
      costSeconds:
        route.duration != null && Number.isFinite(route.duration)
          ? Math.max(0, Math.round(route.duration))
          : route.cost != null && Number.isFinite(route.cost)
            ? Math.max(0, Math.round(route.cost))
            : null,
      distanceMeters:
        route.distance != null && Number.isFinite(route.distance)
          ? Math.max(0, Math.round(route.distance))
          : null,
      assigned: true,
    });
  }

  const assignedSorted = [...assigned.values()].sort((a, b) => {
    const ca = a.costSeconds ?? Number.MAX_SAFE_INTEGER;
    const cb = b.costSeconds ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;
    return a.agentUserId.localeCompare(b.agentUserId);
  });

  const seen = new Set(assignedSorted.map((a) => a.agentUserId));
  const rest: VroomRankedCourier[] = [];
  for (const id of params.fallbackOrder) {
    if (seen.has(id)) continue;
    rest.push({
      agentUserId: id,
      costSeconds: null,
      distanceMeters: null,
      assigned: false,
    });
  }

  return [...assignedSorted, ...rest];
}

/** Ids VROOM 1..n stables pour une liste d’agents. */
export function allocateVroomVehicleIds(
  agentUserIds: string[],
): Map<string, number> {
  const m = new Map<string, number>();
  let i = 1;
  for (const id of agentUserIds) {
    m.set(id, i++);
  }
  return m;
}

export function isVroomDispatchEnabled(raw: string | undefined | null): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
