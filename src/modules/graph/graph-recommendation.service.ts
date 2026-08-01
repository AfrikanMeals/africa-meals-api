import { Injectable, Logger } from '@nestjs/common';
import { Neo4jService } from '@modules/neo4j/neo4j.service';
import { parseRecoGraphTimeoutMs } from '@modules/graphdb-settings/graph-config.util';

/** Neo4j Integer / number → number JS. */
function _neoNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { toNumber?: () => number }).toNumber === 'function'
  ) {
    const n = (v as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class GraphRecommendationService {
  private readonly logger = new Logger(GraphRecommendationService.name);

  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * IDs boutiques personnalisées (Cypher §6.1, fallback §6.3).
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
      MATCH (u:User {userId: $userId})-[:ORDERED_FROM|SUBSCRIBED_TO|FOLLOWS]->(liked:Store)
      MATCH (liked)-[:SIMILAR_TO]->(rec:Store)
      WHERE coalesce(rec.status, 'ACTIVE') = 'ACTIVE'
        AND ($region = '' OR rec.region = $region OR rec.region IS NULL)
        AND NOT (u)-[:ORDERED_FROM]->(rec)
      RETURN rec.storeId AS storeId, count(*) AS score
      ORDER BY score DESC
      LIMIT $limit
      `,
      { userId: uid, region: regionCode, limit: take },
      { timeoutMs, op: 'reco_stores' },
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
        { timeoutMs, op: 'reco_stores_like_you' },
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

  /** Phase 2 — FBT §6.2 */
  async frequentlyBoughtWith(
    productId: string,
    limit = 8,
  ): Promise<Array<{ productId: string; score: number }>> {
    const pid = String(productId ?? '').trim();
    if (!pid) return [];
    const take = Math.min(24, Math.max(1, Math.floor(limit) || 8));
    const rows = await this.neo4j.runCypher<{
      id: string;
      score: number;
    }>(
      `
      MATCH (p:Product {productId: $productId})-[r:FREQUENTLY_BOUGHT_WITH]->(other:Product)
      WHERE coalesce(other.status, 'ACTIVE') = 'ACTIVE'
      RETURN other.productId AS id, r.score AS score
      ORDER BY score DESC
      LIMIT $limit
      `,
      { productId: pid, limit: take },
      { timeoutMs: parseRecoGraphTimeoutMs(), op: 'fbt' },
    );
    return rows
      .map((r) => ({
        productId: String(r.id ?? '').trim(),
        score: Number(r.score) || 0,
      }))
      .filter((r) => r.productId);
  }

  async similarProductIds(
    productId: string,
    limit = 8,
  ): Promise<Array<{ productId: string; score: number }>> {
    const pid = String(productId ?? '').trim();
    if (!pid) return [];
    const take = Math.min(24, Math.max(1, Math.floor(limit) || 8));
    const rows = await this.neo4j.runCypher<{
      id: string;
      score: number;
    }>(
      `
      MATCH (p:Product {productId: $productId})-[r:SIMILAR_TO]->(other:Product)
      WHERE coalesce(other.status, 'ACTIVE') = 'ACTIVE'
      RETURN other.productId AS id, r.score AS score
      ORDER BY score DESC
      LIMIT $limit
      `,
      { productId: pid, limit: take },
      { timeoutMs: parseRecoGraphTimeoutMs(), op: 'similar_products' },
    );
    return rows
      .map((r) => ({
        productId: String(r.id ?? '').trim(),
        score: Number(r.score) || 0,
      }))
      .filter((r) => r.productId);
  }

  /**
   * FBT personnalisé Home : co-achats des plats déjà commandés / vus.
   */
  async personalizedFbtProductIds(
    userId: string,
    limit = 12,
  ): Promise<string[]> {
    const uid = String(userId ?? '').trim();
    if (!uid) return [];
    const take = Math.min(48, Math.max(1, Math.floor(limit) || 12));
    const rows = await this.neo4j.runCypher<{ productId: string }>(
      `
      MATCH (u:User {userId: $userId})-[:ORDERED|VIEWED]->(p:Product)
      MATCH (p)-[r:FREQUENTLY_BOUGHT_WITH]->(rec:Product)
      WHERE coalesce(rec.status, 'ACTIVE') = 'ACTIVE'
        AND NOT (u)-[:ORDERED]->(rec)
      RETURN rec.productId AS productId, sum(r.score) AS score
      ORDER BY score DESC
      LIMIT $limit
      `,
      { userId: uid, limit: take },
      { timeoutMs: parseRecoGraphTimeoutMs(), op: 'fbt_home' },
    );
    return rows
      .map((r) => String(r.productId ?? '').trim())
      .filter(Boolean);
  }

  /**
   * Produits similaires aux plats commandés / vus (SIMILAR_TO).
   */
  async personalizedSimilarProductIds(
    userId: string,
    limit = 12,
  ): Promise<string[]> {
    const uid = String(userId ?? '').trim();
    if (!uid) return [];
    const take = Math.min(48, Math.max(1, Math.floor(limit) || 12));
    const rows = await this.neo4j.runCypher<{ productId: string }>(
      `
      MATCH (u:User {userId: $userId})-[:ORDERED|VIEWED]->(p:Product)
      MATCH (p)-[r:SIMILAR_TO]->(rec:Product)
      WHERE coalesce(rec.status, 'ACTIVE') = 'ACTIVE'
        AND NOT (u)-[:ORDERED]->(rec)
      RETURN rec.productId AS productId, sum(r.score) AS score
      ORDER BY score DESC
      LIMIT $limit
      `,
      { userId: uid, limit: take },
      { timeoutMs: parseRecoGraphTimeoutMs(), op: 'similar_home' },
    );
    return rows
      .map((r) => String(r.productId ?? '').trim())
      .filter(Boolean);
  }

  /**
   * Collab « customers like you » sur produits commandés en commun.
   */
  async collaborativeProductIds(
    userId: string,
    limit = 12,
  ): Promise<string[]> {
    const uid = String(userId ?? '').trim();
    if (!uid) return [];
    const take = Math.min(48, Math.max(1, Math.floor(limit) || 12));
    try {
      const rows = await this.neo4j.runCypher<{ productId: string }>(
        `
        MATCH (u:User {userId: $userId})-[:ORDERED]->(p:Product)<-[:ORDERED]-(other:User)
        WHERE other.userId <> $userId
        WITH u, other, count(DISTINCT p) AS overlap
        ORDER BY overlap DESC
        LIMIT 40
        MATCH (other)-[:ORDERED]->(rec:Product)
        WHERE NOT (u)-[:ORDERED]->(rec)
          AND coalesce(rec.status, 'ACTIVE') = 'ACTIVE'
        RETURN rec.productId AS productId, count(*) AS score
        ORDER BY score DESC
        LIMIT $limit
        `,
        { userId: uid, limit: take },
        { timeoutMs: parseRecoGraphTimeoutMs(), op: 'collab_products' },
      );
      return rows
        .map((r) => String(r.productId ?? '').trim())
        .filter(Boolean);
    } catch (err) {
      this.logger.debug(
        `collab products: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Agrège FBT + similar + collab pour le blend feed (ordre = priorité).
   */
  async personalizedProductIds(
    userId: string,
    limit = 24,
  ): Promise<string[]> {
    const take = Math.min(48, Math.max(1, Math.floor(limit) || 24));
    const per = Math.max(4, Math.ceil(take / 2));
    const [fbt, similar, collab] = await Promise.all([
      this.personalizedFbtProductIds(userId, per),
      this.personalizedSimilarProductIds(userId, per),
      this.collaborativeProductIds(userId, per),
    ]);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of [...fbt, ...similar, ...collab]) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= take) break;
    }
    return out;
  }

  /**
   * Phase 5 — lecture knowledge (tags). Toujours ré-enrichir Mongo côté appelant.
   */
  async productIdsByTag(
    tag: string,
    region: string,
    limit = 24,
  ): Promise<string[]> {
    const slug = String(tag ?? '').trim().toLowerCase();
    if (!slug) return [];
    const regionCode = String(region ?? '').trim().toUpperCase();
    const take = Math.min(48, Math.max(1, Math.floor(limit) || 24));
    const rows = await this.neo4j.runCypher<{ productId: string }>(
      `
      MATCH (p:Product)-[:HAS_TAG]->(t:Tag {slug: $tag})
      OPTIONAL MATCH (p)-[:SERVED_BY]->(s:Store)
      WHERE $region = '' OR s.region = $region OR s.region IS NULL
      RETURN DISTINCT p.productId AS productId
      LIMIT $limit
      `,
      { tag: slug, region: regionCode, limit: take },
      { timeoutMs: parseRecoGraphTimeoutMs(), op: 'knowledge_tag' },
    );
    return rows
      .map((r) => String(r.productId ?? '').trim())
      .filter(Boolean);
  }

  /**
   * Buy Again — candidats déjà commandés (`:ORDERED`) avec stats pour scoring TS.
   * Filtre région boutique ; le classement précis (récence/intérêt) est côté service.
   */
  async buyAgainCandidates(
    userId: string,
    region: string,
    limit = 48,
  ): Promise<
    Array<{
      productId: string;
      orderCount: number;
      lastAt: string | null;
      totalSpent: number;
    }>
  > {
    const uid = String(userId ?? '').trim();
    if (!uid) return [];
    const regionCode = String(region ?? '').trim().toUpperCase();
    // Pool large pour re-score intérêt côté RecommendationsService.
    const take = Math.min(96, Math.max(1, Math.floor(limit) || 48));
    const rows = await this.neo4j.runCypher<{
      productId: string;
      count: number | { toNumber?: () => number };
      lastAt: unknown;
      totalSpent: number | { toNumber?: () => number };
    }>(
      `
      MATCH (u:User {userId: $userId})-[r:ORDERED]->(p:Product)
      MATCH (p)-[:SERVED_BY]->(s:Store)
      WHERE coalesce(p.status, 'ACTIVE') = 'ACTIVE'
        AND coalesce(s.status, 'ACTIVE') = 'ACTIVE'
        AND s.acceptsOrders <> false
        AND ($region = '' OR s.region = $region OR s.region IS NULL)
      RETURN p.productId AS productId,
             r.count AS count,
             r.lastAt AS lastAt,
             coalesce(r.totalSpent, 0) AS totalSpent
      ORDER BY r.lastAt DESC, r.count DESC
      LIMIT $limit
      `,
      { userId: uid, region: regionCode, limit: take },
      { timeoutMs: parseRecoGraphTimeoutMs(), op: 'buy_again' },
    );

    return rows
      .map((r) => {
        const productId = String(r.productId ?? '').trim();
        const orderCount = _neoNum(r.count);
        const totalSpent = _neoNum(r.totalSpent);
        // Neo4j DateTime → string ISO-ish pour scoreBuyAgainCandidate.
        const lastAt =
          r.lastAt == null
            ? null
            : typeof (r.lastAt as { toString?: () => string }).toString ===
                'function'
              ? String((r.lastAt as { toString: () => string }).toString())
              : String(r.lastAt);
        return { productId, orderCount, lastAt, totalSpent };
      })
      .filter((r) => r.productId);
  }

  /** Phase 6 — boutiques qui desservent une zone (anneau). */
  async storeIdsDeliveringToZone(zoneId: string, limit = 24): Promise<string[]> {
    const zid = String(zoneId ?? '').trim();
    if (!zid) return [];
    const take = Math.min(48, Math.max(1, Math.floor(limit) || 24));
    const rows = await this.neo4j.runCypher<{ storeId: string }>(
      `
      MATCH (s:Store)-[:DELIVERS_TO]->(z:Zone {zoneId: $zoneId})
      RETURN s.storeId AS storeId
      LIMIT $limit
      `,
      { zoneId: zid, limit: take },
      { timeoutMs: parseRecoGraphTimeoutMs(), op: 'delivers_to' },
    );
    return rows.map((r) => String(r.storeId ?? '').trim()).filter(Boolean);
  }
}
