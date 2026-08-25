import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isVroomNativeRouter,
  normalizeRoutingEngineId,
  routingEngineTryOrder,
  type RoutingEngineId,
} from '@common/routing-engine-pool.util';
import { resolveDeliveryMatrixRoutingPlan } from '@modules/map-settings/map-settings-region.util';
import { MapSettingsService } from '@modules/map-settings/map-settings.service';
import type { MapSettingsModel } from '@schemas/map-settings.schema';
import { MapEngineCacheService } from '@modules/map-engine-cache/map-engine-cache.service';
import { MapEngineHistoryService } from '@modules/map-engine-cache/map-engine-history.service';
import { mapMatrixCacheKey } from '@modules/map-engine-cache/map-engine-cache.keys';

export type LngLat = [number, number];

export type RoutingDurationMatrix = {
  engine: RoutingEngineId;
  /** Secondes, entiers non négatifs ; diagonale 0. */
  durations: number[][];
  /** Mètres optionnels. */
  distances?: number[][];
};

/**
 * Matrices durée/distance pour VROOM — tous moteurs compatibles du pool.
 * Natif VROOM (OSRM/Valhalla) OU providers payants via API Matrix.
 */
@Injectable()
export class RoutingMatrixService {
  private readonly logger = new Logger(RoutingMatrixService.name);

  constructor(
    private readonly _config: ConfigService,
    @Optional() private readonly _mapCache?: MapEngineCacheService,
    @Optional() private readonly _mapHistory?: MapEngineHistoryService,
    @Optional() private readonly _mapSettings?: MapSettingsService,
  ) {}

  /**
   * Tente les moteurs dans l’ordre (préféré + cascade).
   * Retourne la première matrice valide.
   */
  async fetchDurationMatrixWithFallback(params: {
    coordinates: LngLat[];
    preferred?: RoutingEngineId | null;
    tryOrder?: RoutingEngineId[];
    regionCode?: string | null;
  }): Promise<RoutingDurationMatrix | null> {
    const coords = params.coordinates;
    if (coords.length < 2) return null;

    let preferred = params.preferred ?? null;
    let tryOrder = params.tryOrder;

    if (!preferred || !tryOrder?.length) {
      const plan = await this.resolveDefaultRoutingPlan(params.regionCode);
      preferred = preferred ?? plan.preferred;
      tryOrder = tryOrder?.length ? tryOrder : plan.tryOrder;
    }

    const order = tryOrder?.length
      ? tryOrder
      : routingEngineTryOrder(preferred ?? 'osrm');

    for (const engine of order) {
      try {
        const matrix = await this.fetchDurationMatrix(coords, engine);
        if (matrix) return matrix;
      } catch (e) {
        this.logger.debug(
          `matrix ${engine} failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return null;
  }

  /**
   * Admin → Map Settings (mobileDelivery) prioritaire ;
   * sinon env `VROOM_MATRIX_ENGINE` ; sinon OSRM.
   */
  private async resolveDefaultRoutingPlan(
    regionCode?: string | null,
  ): Promise<{ preferred: RoutingEngineId; tryOrder: RoutingEngineId[] }> {
    try {
      if (this._mapSettings) {
        const doc = await this._mapSettings.getSettingsDocument();
        const plan = resolveDeliveryMatrixRoutingPlan(
          doc as MapSettingsModel,
          regionCode,
        );
        const tryOrder = plan.tryOrder.filter((e) =>
          this.isMatrixProviderConfigured(e),
        );
        if (tryOrder.length) {
          return {
            preferred: tryOrder.includes(plan.preferred)
              ? plan.preferred
              : tryOrder[0]!,
            tryOrder,
          };
        }
      }
    } catch {
      // ignore
    }
    const fromEnv = normalizeRoutingEngineId(
      this._config.get<string>('VROOM_MATRIX_ENGINE') ??
        process.env.VROOM_MATRIX_ENGINE,
    );
    const preferred = fromEnv ?? 'osrm';
    return {
      preferred,
      tryOrder: routingEngineTryOrder(preferred).filter((e) =>
        this.isMatrixProviderConfigured(e),
      ),
    };
  }

  /**
   * Distance routière OD (mètres) pour un seul couple origine→destination.
   * Réutilise la matrice 2×2 déjà câblée (Google Distance Matrix, OSRM table…).
   */
  async fetchOdDrivingDistanceMeters(
    origin: { lat: number; lon: number },
    dest: { lat: number; lon: number },
    engine: RoutingEngineId,
  ): Promise<number | null> {
    const coordinates: LngLat[] = [
      [origin.lon, origin.lat],
      [dest.lon, dest.lat],
    ];
    const matrix = await this.fetchDurationMatrix(coordinates, engine);
    const meters = matrix?.distances?.[0]?.[1];
    if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) {
      return null;
    }
    return meters;
  }

  async fetchDurationMatrix(
    coordinates: LngLat[],
    engine: RoutingEngineId,
  ): Promise<RoutingDurationMatrix | null> {
    const cacheKey = mapMatrixCacheKey(engine, coordinates);
    const ttl = this._mapCache?.ttlSec('matrix') ?? 120;

    const load = async (): Promise<RoutingDurationMatrix | null> => {
      let matrix: RoutingDurationMatrix | null = null;
      switch (engine) {
        case 'osrm':
          matrix = await this.fetchOsrmTable(coordinates);
          break;
        case 'valhalla':
          matrix = await this.fetchValhallaMatrix(coordinates);
          break;
        case 'mapbox':
          matrix = await this.fetchMapboxMatrix(coordinates);
          break;
        case 'google_routes':
        case 'google_directions':
          matrix = await this.fetchGoogleDistanceMatrix(coordinates);
          break;
        case 'here':
          matrix = await this.fetchHereMatrix(coordinates);
          break;
        case 'tomtom':
          matrix = await this.fetchTomtomMatrix(coordinates);
          break;
        default:
          matrix = null;
      }
      if (matrix) {
        const first =
          matrix.durations?.[0]?.[1] ?? matrix.durations?.[1]?.[0] ?? null;
        void this._mapHistory?.recordHistoricalRoute({
          engine,
          kind: 'matrix',
          fingerprintParts: [cacheKey],
          pointCount: coordinates.length,
          durationSeconds:
            typeof first === 'number' && Number.isFinite(first) ? first : null,
          distanceMeters: matrix.distances?.[0]?.[1] ?? null,
        });
      }
      return matrix;
    };

    if (!this._mapCache) {
      return load();
    }

    return this._mapCache.getOrSetJson<RoutingDurationMatrix>(
      cacheKey,
      ttl,
      load,
      { engine, kind: 'matrix' },
    );
  }

  /** True si l’API peut tenter une matrice pour ce moteur (clés / URL présentes). */
  isMatrixProviderConfigured(engine: RoutingEngineId): boolean {
    switch (engine) {
      case 'osrm':
        return this.osrmBase().length > 0;
      case 'valhalla':
        return this.valhallaBase().length > 0;
      case 'mapbox':
        return this.mapboxToken().length > 0;
      case 'google_routes':
      case 'google_directions':
        return this.googleKey().length > 0;
      case 'here':
        return this.hereKey().length > 0;
      case 'tomtom':
        return this.tomtomKey().length > 0;
      default:
        return false;
    }
  }

  canUseVroomNativeWithoutMatrix(engine: RoutingEngineId): boolean {
    return isVroomNativeRouter(engine);
  }

  private osrmBase(): string {
    const raw =
      this._config.get<string>('OSRM_BASE_URL')?.trim() ||
      process.env.OSRM_BASE_URL?.trim() ||
      'https://router.project-osrm.org';
    return raw.replace(/\/+$/, '');
  }

  private valhallaBase(): string {
    const raw =
      this._config.get<string>('VALHALLA_BASE_URL')?.trim() ||
      process.env.VALHALLA_BASE_URL?.trim() ||
      '';
    return raw.replace(/\/+$/, '');
  }

  private mapboxToken(): string {
    return (
      this._config.get<string>('MAPBOX_ACCESS_TOKEN')?.trim() ||
      process.env.MAPBOX_ACCESS_TOKEN?.trim() ||
      this._config.get<string>('MAPBOX_PUBLIC_ACCESS_TOKEN')?.trim() ||
      process.env.MAPBOX_PUBLIC_ACCESS_TOKEN?.trim() ||
      ''
    );
  }

  private googleKey(): string {
    return (
      this._config.get<string>('GOOGLE_MAPS_API_KEY')?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim() ||
      ''
    );
  }

  private hereKey(): string {
    return (
      this._config.get<string>('HERE_API_KEY')?.trim() ||
      process.env.HERE_API_KEY?.trim() ||
      ''
    );
  }

  private tomtomKey(): string {
    return (
      this._config.get<string>('TOMTOM_ROUTING_API_KEY')?.trim() ||
      process.env.TOMTOM_ROUTING_API_KEY?.trim() ||
      this._config.get<string>('TOMTOM_API_KEY')?.trim() ||
      process.env.TOMTOM_API_KEY?.trim() ||
      ''
    );
  }

  private async fetchOsrmTable(
    coordinates: LngLat[],
  ): Promise<RoutingDurationMatrix | null> {
    const path = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
    const url =
      `${this.osrmBase()}/table/v1/driving/${path}` +
      `?annotations=duration,distance`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code?: string;
      durations?: (number | null)[][];
      distances?: (number | null)[][];
    };
    if (json.code && json.code !== 'Ok') return null;
    const durations = sanitizeSquareMatrix(json.durations, coordinates.length);
    if (!durations) return null;
    const distances = sanitizeSquareMatrix(
      json.distances,
      coordinates.length,
      true,
    );
    return {
      engine: 'osrm',
      durations,
      distances: distances ?? undefined,
    };
  }

  private async fetchValhallaMatrix(
    coordinates: LngLat[],
  ): Promise<RoutingDurationMatrix | null> {
    const base = this.valhallaBase();
    if (!base) return null;
    const body = {
      sources: coordinates.map(([lng, lat]) => ({ lon: lng, lat })),
      targets: coordinates.map(([lng, lat]) => ({ lon: lng, lat })),
      costing: 'auto',
    };
    const res = await fetch(`${base}/sources_to_targets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      sources_to_targets?: Array<
        Array<{ time?: number; distance?: number } | null>
      >;
    };
    const rows = json.sources_to_targets;
    if (!Array.isArray(rows) || rows.length !== coordinates.length) return null;
    const durations: number[][] = [];
    const distances: number[][] = [];
    for (let i = 0; i < coordinates.length; i++) {
      const row = rows[i] ?? [];
      const dRow: number[] = [];
      const distRow: number[] = [];
      for (let j = 0; j < coordinates.length; j++) {
        const cell = row[j];
        const t = cell?.time;
        dRow.push(
          i === j
            ? 0
            : t != null && Number.isFinite(t)
              ? Math.max(0, Math.round(t))
              : 0,
        );
        const distKm = cell?.distance;
        distRow.push(
          i === j
            ? 0
            : distKm != null && Number.isFinite(distKm)
              ? Math.max(0, Math.round(distKm * 1000))
              : 0,
        );
      }
      durations.push(dRow);
      distances.push(distRow);
    }
    return { engine: 'valhalla', durations, distances };
  }

  private async fetchMapboxMatrix(
    coordinates: LngLat[],
  ): Promise<RoutingDurationMatrix | null> {
    const token = this.mapboxToken();
    if (!token) return null;
    // Limite Mapbox Matrix free : souvent 25 coordonnées.
    if (coordinates.length > 25) return null;
    const path = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
    const url =
      `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${path}` +
      `?annotations=duration,distance&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code?: string;
      durations?: (number | null)[][];
      distances?: (number | null)[][];
    };
    if (json.code && json.code !== 'Ok') return null;
    const durations = sanitizeSquareMatrix(json.durations, coordinates.length);
    if (!durations) return null;
    const distances = sanitizeSquareMatrix(
      json.distances,
      coordinates.length,
      true,
    );
    return {
      engine: 'mapbox',
      durations,
      distances: distances ?? undefined,
    };
  }

  private async fetchGoogleDistanceMatrix(
    coordinates: LngLat[],
  ): Promise<RoutingDurationMatrix | null> {
    const key = this.googleKey();
    if (!key) return null;
    if (coordinates.length > 25) return null;
    const origins = coordinates
      .map(([lng, lat]) => `${lat},${lng}`)
      .join('|');
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${encodeURIComponent(origins)}` +
      `&destinations=${encodeURIComponent(origins)}` +
      `&mode=driving&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      rows?: Array<{
        elements?: Array<{
          status?: string;
          duration?: { value?: number };
          distance?: { value?: number };
        }>;
      }>;
    };
    if (json.status && json.status !== 'OK') return null;
    const n = coordinates.length;
    const durations: number[][] = [];
    const distances: number[][] = [];
    for (let i = 0; i < n; i++) {
      const elements = json.rows?.[i]?.elements ?? [];
      const dRow: number[] = [];
      const distRow: number[] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          dRow.push(0);
          distRow.push(0);
          continue;
        }
        const el = elements[j];
        if (!el || el.status !== 'OK') {
          dRow.push(0);
          distRow.push(0);
          continue;
        }
        dRow.push(Math.max(0, Math.round(Number(el.duration?.value ?? 0))));
        distRow.push(Math.max(0, Math.round(Number(el.distance?.value ?? 0))));
      }
      durations.push(dRow);
      distances.push(distRow);
    }
    return { engine: 'google_directions', durations, distances };
  }

  private async fetchHereMatrix(
    coordinates: LngLat[],
  ): Promise<RoutingDurationMatrix | null> {
    const key = this.hereKey();
    if (!key) return null;
    if (coordinates.length > 15) return null;
    // HERE Matrix Routing v8 — origins=destinations same set.
    const origins = coordinates
      .map(([lng, lat]) => `${lat},${lng}`)
      .join(';');
    const url =
      `https://matrix.router.hereapi.com/v8/matrix` +
      `?apiKey=${encodeURIComponent(key)}` +
      `&async=false` +
      `&regionDefinitionType=world`;
    const body = {
      origins: coordinates.map(([lng, lat]) => ({ lat, lng })),
      destinations: coordinates.map(([lng, lat]) => ({ lat, lng })),
      regionDefinition: { type: 'world' },
      matrixAttributes: ['travelTimes', 'distances'],
      transportMode: 'car',
    };
    void origins;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      matrix?: {
        travelTimes?: number[];
        distances?: number[];
        numOrigins?: number;
        numDestinations?: number;
      };
    };
    const n = coordinates.length;
    const flatT = json.matrix?.travelTimes;
    if (!Array.isArray(flatT) || flatT.length < n * n) return null;
    const flatD = json.matrix?.distances;
    const durations: number[][] = [];
    const distances: number[][] = [];
    for (let i = 0; i < n; i++) {
      const dRow: number[] = [];
      const distRow: number[] = [];
      for (let j = 0; j < n; j++) {
        const idx = i * n + j;
        dRow.push(Math.max(0, Math.round(Number(flatT[idx] ?? 0))));
        distRow.push(
          flatD
            ? Math.max(0, Math.round(Number(flatD[idx] ?? 0)))
            : 0,
        );
      }
      durations.push(dRow);
      distances.push(distRow);
    }
    return {
      engine: 'here',
      durations,
      distances: flatD ? distances : undefined,
    };
  }

  private async fetchTomtomMatrix(
    coordinates: LngLat[],
  ): Promise<RoutingDurationMatrix | null> {
    const key = this.tomtomKey();
    if (!key) return null;
    if (coordinates.length > 100) return null;
    const url =
      `https://api.tomtom.com/routing/matrix/2` +
      `?key=${encodeURIComponent(key)}`;
    const body = {
      origins: coordinates.map(([lng, lat]) => ({
        point: { latitude: lat, longitude: lng },
      })),
      destinations: coordinates.map(([lng, lat]) => ({
        point: { latitude: lat, longitude: lng },
      })),
      options: {
        travelMode: 'car',
        routeType: 'fastest',
        traffic: 'historical',
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{
        routeSummary?: {
          travelTimeInSeconds?: number;
          lengthInMeters?: number;
        };
      }>;
      matrix?: unknown;
    };
    // Matrix sync response shape varies; support flat data n*n.
    const n = coordinates.length;
    const data = json.data;
    if (!Array.isArray(data) || data.length < n * n) return null;
    const durations: number[][] = [];
    const distances: number[][] = [];
    for (let i = 0; i < n; i++) {
      const dRow: number[] = [];
      const distRow: number[] = [];
      for (let j = 0; j < n; j++) {
        const cell = data[i * n + j];
        dRow.push(
          Math.max(
            0,
            Math.round(Number(cell?.routeSummary?.travelTimeInSeconds ?? 0)),
          ),
        );
        distRow.push(
          Math.max(
            0,
            Math.round(Number(cell?.routeSummary?.lengthInMeters ?? 0)),
          ),
        );
      }
      durations.push(dRow);
      distances.push(distRow);
    }
    return { engine: 'tomtom', durations, distances };
  }
}

function sanitizeSquareMatrix(
  raw: (number | null)[][] | undefined,
  n: number,
  allowFloat = false,
): number[][] | null {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = raw[i];
    if (!Array.isArray(row) || row.length !== n) return null;
    const next: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        next.push(0);
        continue;
      }
      const v = row[j];
      if (v == null || !Number.isFinite(v)) {
        next.push(0);
        continue;
      }
      next.push(allowFloat ? Math.max(0, Math.round(v)) : Math.max(0, Math.round(v)));
    }
    out.push(next);
  }
  return out;
}
