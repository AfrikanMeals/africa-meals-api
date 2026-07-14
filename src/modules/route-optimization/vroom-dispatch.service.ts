import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  normalizeRoutingEngineId,
  routingEngineTryOrder,
  type RoutingEngineId,
} from '@common/routing-engine-pool.util';
import { resolveRoutingEngineForRegion } from '@modules/map-settings/map-settings-region.util';
import { MapSettingsService } from '@modules/map-settings/map-settings.service';
import type { MapSettingsModel } from '@schemas/map-settings.schema';
import { RoutingMatrixService } from './routing-matrix.service';
import {
  naiveBatchTourStops,
  parseCourierTourStopsFromVroomSolution,
  type CourierTourResult,
  type CourierTourStop,
} from './vroom-courier-tour.util';
import {
  allocateVroomVehicleIds,
  buildFoodDeliveryVroomProblem,
  isVroomDispatchEnabled,
  rankCouriersFromVroomSolution,
  type VroomLngLat,
  type VroomRankedCourier,
  type VroomVehicleInput,
} from './vroom-problem.util';
import { VroomClient } from './vroom.client';

export type VroomCourierCandidate = {
  agentUserId: string;
  lastLatitude?: number | null;
  lastLongitude?: number | null;
  /** Slots libres (maxConcurrent - active). */
  remainingCapacity: number;
};

export type { CourierTourResult, CourierTourStop };

/**
 * Optimisation multi-stop / multi-véhicule via VROOM.
 * Matrices : OSRM · Valhalla · Mapbox · Google · HERE · TomTom (pool delivery).
 * Routeur natif VROOM : OSRM / Valhalla si matrice indisponible.
 */
@Injectable()
export class VroomDispatchService {
  private readonly logger = new Logger(VroomDispatchService.name);

  constructor(
    private readonly _config: ConfigService,
    private readonly _vroom: VroomClient,
    private readonly _matrix: RoutingMatrixService,
    @Optional() private readonly _mapSettings?: MapSettingsService,
  ) {}

  isEnabled(): boolean {
    const flag = isVroomDispatchEnabled(
      this._config.get<string>('VROOM_DISPATCH_ENABLED') ??
        process.env.VROOM_DISPATCH_ENABLED,
    );
    return flag && this._vroom.isConfigured();
  }

  /**
   * Classe les livreurs pour **une** commande (shipment boutique→client).
   * Retourne `null` si VROOM off / erreur → l’appelant garde le ranking GEO.
   */
  async rankCouriersForSingleShipment(params: {
    storeLngLat: VroomLngLat;
    deliveryLngLat: VroomLngLat;
    couriers: VroomCourierCandidate[];
    /** Ordre GEO/haversine déjà calculé (userIds). */
    fallbackOrder: string[];
    orderLabel?: string;
    preferredMatrixEngine?: RoutingEngineId | null;
  }): Promise<VroomRankedCourier[] | null> {
    if (!this.isEnabled()) return null;

    const withGps = params.couriers.filter((c) => {
      const lat = c.lastLatitude;
      const lng = c.lastLongitude;
      return (
        lat != null &&
        lng != null &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        c.remainingCapacity > 0
      );
    });
    if (withGps.length === 0) return null;

    const idMap = allocateVroomVehicleIds(withGps.map((c) => c.agentUserId));
    const vehicles: VroomVehicleInput[] = withGps.map((c) => ({
      id: idMap.get(c.agentUserId)!,
      description: c.agentUserId,
      start: [Number(c.lastLongitude), Number(c.lastLatitude)],
      capacitySlots: c.remainingCapacity,
    }));

    const coords: VroomLngLat[] = [
      ...vehicles.map((v) => v.start),
      params.storeLngLat,
      params.deliveryLngLat,
    ];

    const preferred = await this.resolvePreferredMatrixEngine(
      params.preferredMatrixEngine,
    );
    const matrix = await this._matrix.fetchDurationMatrixWithFallback({
      coordinates: coords,
      preferred,
      tryOrder: routingEngineTryOrder(preferred).filter((e) =>
        this._matrix.isMatrixProviderConfigured(e),
      ),
    });

    const problem = buildFoodDeliveryVroomProblem({
      vehicles,
      shipments: [
        {
          shipmentId: 1,
          description: params.orderLabel ?? 'order',
          pickup: params.storeLngLat,
          delivery: params.deliveryLngLat,
          amount: 1,
          priority: 80,
        },
      ],
      matrices: matrix
        ? { durations: matrix.durations, distances: matrix.distances }
        : null,
    });

    if (problem.vehicles.length === 0 || problem.shipments.length === 0) {
      return null;
    }

    if (!matrix && !this._matrix.canUseVroomNativeWithoutMatrix(preferred)) {
      const nativeOk = routingEngineTryOrder(preferred).some(
        (e) =>
          this._matrix.canUseVroomNativeWithoutMatrix(e) &&
          this._matrix.isMatrixProviderConfigured(e),
      );
      if (!nativeOk) {
        this.logger.debug(
          'VROOM skip: aucune matrice (Mapbox/Google/…) ni routeur natif',
        );
        return null;
      }
    }

    try {
      if (matrix) {
        this.logger.debug(
          `VROOM matrix engine=${matrix.engine} size=${matrix.durations.length}`,
        );
      }
      const solution = await this._vroom.solve(problem);
      if (solution.code != null && solution.code !== 0) {
        this.logger.warn(
          `VROOM code=${solution.code} error=${solution.error ?? ''}`,
        );
        return null;
      }
      return rankCouriersFromVroomSolution({
        solution,
        vehicles,
        fallbackOrder: params.fallbackOrder,
      });
    } catch (e) {
      this.logger.warn(
        `VROOM solve failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Optimise la tournée d’**un** livreur déjà chargé (N commandes).
   * Au lieu de N Directions Google indépendants → séquence VROOM
   * (ex. Pickup A → Pickup B → Deliver A → Deliver B).
   */
  async optimizeCourierTour(params: {
    agentUserId: string;
    startLngLat: VroomLngLat;
    shipments: Array<{
      orderId: string;
      pickupLngLat: VroomLngLat;
      deliveryLngLat: VroomLngLat;
      priority?: number;
    }>;
    preferredMatrixEngine?: RoutingEngineId | null;
    allowNaiveFallback?: boolean;
  }): Promise<CourierTourResult | null> {
    const shipments = params.shipments.filter(
      (s) =>
        s.orderId &&
        Number.isFinite(s.pickupLngLat[0]) &&
        Number.isFinite(s.pickupLngLat[1]) &&
        Number.isFinite(s.deliveryLngLat[0]) &&
        Number.isFinite(s.deliveryLngLat[1]),
    );
    if (shipments.length < 2) return null;

    const meta = shipments.map((s) => ({
      orderId: s.orderId,
      pickup: s.pickupLngLat,
      delivery: s.deliveryLngLat,
    }));

    const naive = (): CourierTourResult => ({
      stops: naiveBatchTourStops(meta),
      durationSeconds: null,
      distanceMeters: null,
    });

    if (!this.isEnabled()) {
      return params.allowNaiveFallback === false ? null : naive();
    }

    const vehicles: VroomVehicleInput[] = [
      {
        id: 1,
        description: params.agentUserId,
        start: params.startLngLat,
        capacitySlots: Math.max(shipments.length, 1),
      },
    ];

    const vroomShipments = shipments.map((s, idx) => ({
      shipmentId: idx + 1,
      description: s.orderId,
      pickup: s.pickupLngLat,
      delivery: s.deliveryLngLat,
      amount: 1,
      priority: s.priority ?? 50,
    }));

    const coords: VroomLngLat[] = [
      params.startLngLat,
      ...vroomShipments.flatMap((s) => [s.pickup, s.delivery]),
    ];
    const preferred = await this.resolvePreferredMatrixEngine(
      params.preferredMatrixEngine,
    );
    const matrix = await this._matrix.fetchDurationMatrixWithFallback({
      coordinates: coords,
      preferred,
      tryOrder: routingEngineTryOrder(preferred).filter((e) =>
        this._matrix.isMatrixProviderConfigured(e),
      ),
    });

    const problem = buildFoodDeliveryVroomProblem({
      vehicles,
      shipments: vroomShipments,
      matrices: matrix
        ? { durations: matrix.durations, distances: matrix.distances }
        : null,
    });

    try {
      const solution = await this._vroom.solve(problem);
      const parsed = parseCourierTourStopsFromVroomSolution(solution, meta);
      if (parsed && parsed.stops.length >= 2) {
        this.logger.debug(
          `VROOM courier tour agent=${params.agentUserId} stops=${parsed.stops.length}`,
        );
        return parsed;
      }
    } catch (e) {
      this.logger.warn(
        `VROOM courier tour failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    return params.allowNaiveFallback === false ? null : naive();
  }

  /**
   * Optimisation batch multi-commandes / multi-livreurs.
   */
  async optimizeFleetShipments(params: {
    storeLngLat: VroomLngLat;
    shipments: Array<{
      orderId: string;
      deliveryLngLat: VroomLngLat;
      pickupLngLat?: VroomLngLat;
      priority?: number;
    }>;
    couriers: VroomCourierCandidate[];
    preferredMatrixEngine?: RoutingEngineId | null;
  }) {
    if (!this.isEnabled()) return null;
    const withGps = params.couriers.filter((c) => {
      const lat = c.lastLatitude;
      const lng = c.lastLongitude;
      return (
        lat != null &&
        lng != null &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        c.remainingCapacity > 0
      );
    });
    if (withGps.length === 0 || params.shipments.length === 0) return null;

    const idMap = allocateVroomVehicleIds(withGps.map((c) => c.agentUserId));
    const vehicles: VroomVehicleInput[] = withGps.map((c) => ({
      id: idMap.get(c.agentUserId)!,
      description: c.agentUserId,
      start: [Number(c.lastLongitude), Number(c.lastLatitude)],
      capacitySlots: c.remainingCapacity,
    }));

    const shipments = params.shipments.map((s, idx) => ({
      shipmentId: idx + 1,
      description: s.orderId,
      pickup: s.pickupLngLat ?? params.storeLngLat,
      delivery: s.deliveryLngLat,
      amount: 1,
      priority: s.priority ?? 50,
    }));

    const coords: VroomLngLat[] = [
      ...vehicles.map((v) => v.start),
      ...shipments.flatMap((s) => [s.pickup, s.delivery]),
    ];
    const preferred = await this.resolvePreferredMatrixEngine(
      params.preferredMatrixEngine,
    );
    const matrix = await this._matrix.fetchDurationMatrixWithFallback({
      coordinates: coords,
      preferred,
      tryOrder: routingEngineTryOrder(preferred).filter((e) =>
        this._matrix.isMatrixProviderConfigured(e),
      ),
    });

    const problem = buildFoodDeliveryVroomProblem({
      vehicles,
      shipments,
      matrices: matrix
        ? { durations: matrix.durations, distances: matrix.distances }
        : null,
    });
    try {
      return await this._vroom.solve(problem);
    } catch (e) {
      this.logger.warn(
        `VROOM batch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private async resolvePreferredMatrixEngine(
    override?: RoutingEngineId | null,
  ): Promise<RoutingEngineId> {
    if (override) return override;
    const fromEnv = normalizeRoutingEngineId(
      this._config.get<string>('VROOM_MATRIX_ENGINE') ??
        process.env.VROOM_MATRIX_ENGINE,
    );
    if (fromEnv) return fromEnv;
    try {
      if (this._mapSettings) {
        const doc = await this._mapSettings.getSettingsDocument();
        const engine = resolveRoutingEngineForRegion(
          doc as MapSettingsModel,
          'mobileDelivery',
        );
        const id = normalizeRoutingEngineId(engine);
        if (id) return id;
      }
    } catch {
      // map-settings indisponible
    }
    return 'osrm';
  }
}
