import { Injectable, Logger, Optional } from '@nestjs/common';
import { Neo4jService } from '@modules/neo4j/neo4j.service';
import { isNeo4jEnabled } from '@modules/graphdb-settings/graph-config.util';
import {
  regionAvailabilityZoneId,
  trafficCellId,
} from './graph-map-cell.util';

/**
 * Lectures soft map intelligence (Neo4j).
 * Ne remplace jamais OSRM / VROOM / Redis GEO pour le routage ou le GPS live.
 */
@Injectable()
export class GraphMapIntelligenceService {
  private readonly logger = new Logger(GraphMapIntelligenceService.name);

  constructor(@Optional() private readonly neo4j?: Neo4jService) {}

  /**
   * Livreurs récemment vus dans une Zone région (`AVAILABLE_IN`).
   * Fail-open → [].
   */
  async courierIdsAvailableInRegion(
    regionCode: string,
    opts?: { maxAgeMinutes?: number; limit?: number },
  ): Promise<string[]> {
    if (!this.neo4j || !isNeo4jEnabled()) return [];
    const zoneId = regionAvailabilityZoneId(regionCode);
    const maxAge = Math.max(1, opts?.maxAgeMinutes ?? 30);
    const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
    try {
      const rows = await this.neo4j.runCypher<{ agentUserId: string }>(
        `
        MATCH (c:Courier)-[r:AVAILABLE_IN]->(z:Zone {zoneId: $zoneId})
        WHERE c.lastSeenAt IS NOT NULL
          AND c.lastSeenAt > datetime() - duration({minutes: $maxAge})
          AND coalesce(c.availability, r.availability, '') <> 'hors_ligne'
        RETURN c.agentUserId AS agentUserId
        ORDER BY c.lastSeenAt DESC
        LIMIT $limit
        `,
        { zoneId, maxAge, limit },
        { timeoutMs: 4_000, op: 'map_courier_region' },
      );
      return rows
        .map((r) => String(r.agentUserId ?? '').trim())
        .filter(Boolean);
    } catch (err) {
      this.logger.debug(
        `courierIdsAvailableInRegion: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /**
   * Facteur trafic moyen cellule (~hint ETA). `null` si graphe off / miss.
   * Le routage le plus court chemin reste OSRM.
   */
  async averageTrafficFactorNear(
    latitude: number,
    longitude: number,
  ): Promise<number | null> {
    if (!this.neo4j || !isNeo4jEnabled()) return null;
    const cellId = trafficCellId(latitude, longitude);
    if (!cellId) return null;
    try {
      const rows = await this.neo4j.runCypher<{ factor: number }>(
        `
        MATCH (t:TrafficCell {cellId: $cellId})
        WHERE t.avgFactor IS NOT NULL
          AND t.lastAt > datetime() - duration({hours: 6})
        RETURN t.avgFactor AS factor
        LIMIT 1
        `,
        { cellId },
        { timeoutMs: 3_000, op: 'map_traffic_hint' },
      );
      const f = Number(rows[0]?.factor);
      if (!Number.isFinite(f) || f <= 0) return null;
      return Math.min(2.5, Math.max(0.7, f));
    } catch (err) {
      this.logger.debug(
        `averageTrafficFactorNear: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
