import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isVroomNativeRouter,
  normalizeRoutingEngineId,
  routingEngineTryOrder,
  type RoutingEngineId,
} from '@common/routing-engine-pool.util';

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

  constructor(private readonly _config: ConfigService) {}

  /**
   * Tente les moteurs dans l’ordre (préféré + cascade).
   * Retourne la première matrice valide.
   */
  async fetchDurationMatrixWithFallback(params: {
    coordinates: LngLat[];
    preferred?: RoutingEngineId | null;
    tryOrder?: RoutingEngineId[];
  }): Promise<RoutingDurationMatrix | null> {
    const coords = params.coordinates;
    if (coords.length < 2) return null;
    const preferred =
      params.preferred ??
      normalizeRoutingEngineId(
        this._config.get<string>('VROOM_MATRIX_ENGINE') ??
          process.env.VROOM_MATRIX_ENGINE,
      ) ??
      'osrm';
    const order = params.tryOrder?.length
      ? params.tryOrder
      : routingEngineTryOrder(preferred);

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

  async fetchDurationMatrix(
    coordinates: LngLat[],
    engine: RoutingEngineId,
  ): Promise<RoutingDurationMatrix | null> {
    switch (engine) {
      case 'osrm':
        return this.fetchOsrmTable(coordinates);
      case 'valhalla':
        return this.fetchValhallaMatrix(coordinates);
      case 'mapbox':
        return this.fetchMapboxMatrix(coordinates);
      case 'google_routes':
      case 'google_directions':
        return this.fetchGoogleDistanceMatrix(coordinates);
      case 'here':
        return this.fetchHereMatrix(coordinates);
      case 'tomtom':
        return this.fetchTomtomMatrix(coordinates);
      default:
        return null;
    }
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
