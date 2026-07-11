import { Injectable, Logger } from '@nestjs/common';
import { Neo4jService } from '@modules/neo4j/neo4j.service';
import { parseRecoGraphTimeoutMs } from '@modules/graphdb-settings/graph-config.util';

@Injectable()
export class GraphRecommendationService {
  private readonly logger = new Logger(GraphRecommendationService.name);

  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * IDs boutiques personnalisées (Cypher §6.1, fallback §6.3).
   * Ne ré-enrichit pas Mongo — appelant filtre région / visibilité.
   */
  async personalizedStoreIds(
    userId: string,
    region: string,
    limit = 12,
  ): Promise<string[]> {
    const uid = String(userId ?? '').trim();
    if (!uid) return [];
    const regionCode = String(region ?? '').trim().toUpperCase();
    const take = Math.min(48, Math.max(1, Math.floor(limit) || 12));
    const timeoutMs = parseRecoGraphTimeoutMs();

    const primary = await this.neo4j.runCypher<{ storeId: string }>(
      `
      MATCH (u:User {userId: $userId})-[:ORDERED_FROM|SUBSCRIBED_TO]->(liked:Store)
      MATCH (liked)-[:SIMILAR_TO]->(rec:Store)
      WHERE coalesce(rec.status, 'ACTIVE') = 'ACTIVE'
        AND ($region = '' OR rec.region = $region OR rec.region IS NULL)
        AND NOT (u)-[:ORDERED_FROM]->(rec)
      RETURN rec.storeId AS storeId, count(*) AS score
      ORDER BY score DESC
      LIMIT $limit
      `,
      { userId: uid, region: regionCode, limit: take },
      { timeoutMs },
    );

    let ids = primary
      .map((r) => String(r.storeId ?? '').trim())
      .filter(Boolean);

    if (ids.length >= Math.min(3, take)) {
      return ids.slice(0, take);
    }

    try {
      const fallback = await this.neo4j.runCypher<{ storeId: string }>(
        `
        MATCH (u:User {userId: $userId})-[:ORDERED_FROM]->(s:Store)<-[:ORDERED_FROM]-(other:User)
        WHERE other.userId <> $userId
        WITH u, other, count(DISTINCT s) AS overlap
        ORDER BY overlap DESC
        LIMIT 50
        MATCH (other)-[:ORDERED_FROM]->(rec:Store)
        WHERE NOT (u)-[:ORDERED_FROM]->(rec)
          AND coalesce(rec.status, 'ACTIVE') = 'ACTIVE'
          AND ($region = '' OR rec.region = $region OR rec.region IS NULL)
        RETURN rec.storeId AS storeId, count(*) AS score
        ORDER BY score DESC
        LIMIT $limit
        `,
        { userId: uid, region: regionCode, limit: take },
        { timeoutMs },
      );
      const more = fallback
        .map((r) => String(r.storeId ?? '').trim())
        .filter(Boolean);
      const seen = new Set(ids);
      for (const id of more) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= take) break;
      }
    } catch (err) {
      this.logger.debug(
        `customers-like-you fallback: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return ids.slice(0, take);
  }
}
