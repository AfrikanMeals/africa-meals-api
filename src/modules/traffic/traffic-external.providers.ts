import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { resolveTomTomApiKey } from '@common/tomtom-api-key.util';
import { trafficFactorFromSpeeds } from '@common/traffic-engine-pool.util';
import {
  resolveMapboxGeocodingToken,
  resolveMapboxPublicAccessToken,
} from '@common/mapbox-geocoding.util';

/**
 * Providers trafic externes TomTom / Mapbox.
 */
@Injectable()
export class TrafficExternalProviders {
  private readonly logger = new Logger(TrafficExternalProviders.name);

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretManagerService,
  ) {}

  async resolveTomTomFactor(
    lat: number,
    lng: number,
  ): Promise<number | null> {
    const apiKey = await resolveTomTomApiKey(this.secrets, this.config);
    if (!apiKey) return null;
    const url =
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
      `?key=${encodeURIComponent(apiKey)}&point=${lat},${lng}`;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        flowSegmentData?: {
          currentSpeed?: number;
          freeFlowSpeed?: number;
        };
      };
      const cur = Number(json.flowSegmentData?.currentSpeed);
      const free = Number(json.flowSegmentData?.freeFlowSpeed);
      if (!Number.isFinite(cur) || !Number.isFinite(free) || free <= 0) {
        return null;
      }
      return trafficFactorFromSpeeds({
        observedSpeedKmh: cur,
        freeFlowSpeedKmh: free,
      });
    } catch (e) {
      this.logger.debug(
        `TomTom traffic: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Mapbox : compare durée `driving-traffic` vs `driving` sur un tronçon court.
   */
  async resolveMapboxFactor(
    lat: number,
    lng: number,
    headingDegrees?: number | null,
  ): Promise<number | null> {
    const token =
      (await resolveMapboxGeocodingToken(this.secrets, this.config)) ||
      (await resolveMapboxPublicAccessToken(this.secrets, this.config));
    if (!token) return null;

    const heading =
      Number.isFinite(Number(headingDegrees)) && Number(headingDegrees) >= 0
        ? Number(headingDegrees)
        : 0;
    // ~600 m devant selon le cap.
    const distDeg = 0.0055;
    const rad = (heading * Math.PI) / 180;
    const toLat = lat + distDeg * Math.cos(rad);
    const toLng = lng + (distDeg * Math.sin(rad)) / Math.cos((lat * Math.PI) / 180);
    const coords = `${lng},${lat};${toLng},${toLat}`;

    const durationFor = async (profile: string): Promise<number | null> => {
      const uri =
        `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}` +
        `?overview=false&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(uri, {
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        routes?: Array<{ duration?: number }>;
      };
      const d = Number(body.routes?.[0]?.duration);
      return Number.isFinite(d) && d > 0 ? d : null;
    };

    try {
      const [trafficDur, freeDur] = await Promise.all([
        durationFor('driving-traffic'),
        durationFor('driving'),
      ]);
      if (trafficDur == null || freeDur == null || freeDur <= 0) return null;
      const factor = trafficDur / freeDur;
      return Math.min(2.5, Math.max(0.7, factor));
    } catch (e) {
      this.logger.debug(
        `Mapbox traffic: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}
