import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  billableDistanceEngineTryOrder,
  type RoutingEngineId,
} from '@common/routing-engine-pool.util';
import { MapEngineCacheService } from '@modules/map-engine-cache/map-engine-cache.service';
import { mapDistanceCacheKey } from '@modules/map-engine-cache/map-engine-cache.keys';
import {
  haversineDistanceKm,
  pickBillableDistanceKm,
} from '@modules/platform-shipping-settings/shipping-quote.util';
import { RoutingMatrixService } from './routing-matrix.service';

export type BillableDistanceSource = 'driving_route' | 'haversine_fallback';

export type BillableDistanceResult = {
  distanceKm: number;
  source: BillableDistanceSource;
  engine: RoutingEngineId | null;
};

/** TTL facturation : boutique→adresse est stable (évite de re-payer Google à chaque preview). */
const BILLABLE_DISTANCE_TTL_SEC = 900;

/**
 * Distance facturable canonique : itinéraire routier (Google Distance Matrix
 * prioritaire) ; Haversine uniquement si tous les moteurs échouent.
 * Ne pas utiliser pour le tri « nearby » ni le GPS live.
 */
@Injectable()
export class DrivingDistanceService {
  private readonly logger = new Logger(DrivingDistanceService.name);

  constructor(
    private readonly _matrix: RoutingMatrixService,
    // Cache OD 15 min — évite de re-payer Google à chaque preview checkout.
    @Optional() private readonly _mapCache?: MapEngineCacheService,
  ) {}

  async resolveBillableDistanceKm(args: {
    origin: { lat: number; lon: number };
    dest: { lat: number; lon: number };
  }): Promise<BillableDistanceResult> {
    // Plancher + repli si aucun moteur ne répond.
    const haversineKm = haversineDistanceKm(
      args.origin.lat,
      args.origin.lon,
      args.dest.lat,
      args.dest.lon,
    );

    const cacheKey = mapDistanceCacheKey(
      'billable',
      { lat: args.origin.lat, lng: args.origin.lon },
      { lat: args.dest.lat, lng: args.dest.lon },
    );

    if (this._mapCache) {
      const cached = await this._mapCache.getJson<BillableDistanceResult>(cacheKey);
      // Cache hit seulement si routage réel — un repli Haversine ne doit pas
      // bloquer un retry moteur (clé absente, quota, timeout transitoire).
      if (cached?.source === 'driving_route' && cached.distanceKm > 0) {
        return cached;
      }
    }

    // Google d’abord (aligné Gmaps), puis cascade ; un seul essai Google.
    const tryOrder = billableDistanceEngineTryOrder((engine) =>
      this._matrix.isMatrixProviderConfigured(engine),
    );

    for (const engine of tryOrder) {
      try {
        const meters = await this._matrix.fetchOdDrivingDistanceMeters(
          args.origin,
          args.dest,
          engine,
        );
        if (meters == null) continue;
        // Convertit mètres → km puis applique le plancher Haversine.
        const routeKm = meters / 1000;
        const result: BillableDistanceResult = {
          distanceKm: pickBillableDistanceKm(haversineKm, routeKm),
          source: 'driving_route',
          engine,
        };
        await this._mapCache?.setJson(
          cacheKey,
          result,
          BILLABLE_DISTANCE_TTL_SEC,
        );
        return result;
      } catch (e) {
        this.logger.debug(
          `billable distance ${engine} failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    this.logger.warn(
      'billable distance: no routing engine — haversine fallback (undercharge risk)',
    );
    return {
      distanceKm: pickBillableDistanceKm(haversineKm, null),
      source: 'haversine_fallback',
      engine: null,
    };
  }
}
