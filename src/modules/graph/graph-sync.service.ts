import { Injectable, Logger } from '@nestjs/common';
import { Neo4jService } from '@modules/neo4j/neo4j.service';
import { deriveProductTagsFromText, zoneIdFromShippingRing } from './graph-knowledge.util';
import type {
  GraphOrderCompletedPayload,
  GraphProductSimilarityPayload,
  GraphProductTagsPayload,
  GraphSignalTrackedPayload,
  GraphStoreSimilarityPayload,
  GraphStoreSubscribedPayload,
  GraphStoreZonesPayload,
} from './graph-sync.types';

const CONSTRAINTS_CYPHER = `
CREATE CONSTRAINT user_userId IF NOT EXISTS FOR (u:User) REQUIRE u.userId IS UNIQUE;
CREATE CONSTRAINT store_storeId IF NOT EXISTS FOR (s:Store) REQUIRE s.storeId IS UNIQUE;
CREATE CONSTRAINT product_productId IF NOT EXISTS FOR (p:Product) REQUIRE p.productId IS UNIQUE;
CREATE CONSTRAINT drink_drinkId IF NOT EXISTS FOR (d:Drink) REQUIRE d.drinkId IS UNIQUE;
`;

@Injectable()
export class GraphSyncService {
  private readonly logger = new Logger(GraphSyncService.name);
  private constraintsReady = false;

  constructor(private readonly neo4j: Neo4jService) {}

  async ensureConstraints(): Promise<void> {
    if (this.constraintsReady) return;
    const statements = CONSTRAINTS_CYPHER.split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const q of statements) {
      try {
        await this.neo4j.runCypher(q, {}, { timeoutMs: 15_000 });
      } catch (err) {
        this.logger.warn(
          `constraint bootstrap: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.constraintsReady = true;
  }

  async applyOrderCompleted(payload: GraphOrderCompletedPayload): Promise<void> {
    await this.ensureConstraints();
    const completedAt = payload.completedAt || new Date().toISOString();
    const region = (payload.region ?? '').trim().toUpperCase() || null;
    const totalSpent = Number(payload.totalSpent) || 0;

    await this.neo4j.runCypher(
      `
      MERGE (u:User {userId: $userId})
      ON CREATE SET u.createdAt = datetime($completedAt)
      SET u.lastOrderAt = datetime($completedAt)
      MERGE (s:Store {storeId: $storeId})
      ON CREATE SET s.createdAt = datetime($completedAt)
      SET s.status = coalesce(s.status, 'ACTIVE')
      FOREACH (_ IN CASE WHEN $region IS NULL THEN [] ELSE [1] END |
        SET s.region = $region
      )
      MERGE (u)-[of:ORDERED_FROM]->(s)
      ON CREATE SET of.count = 0
      SET of.count = of.count + 1,
          of.lastAt = datetime($completedAt)
      `,
      {
        userId: payload.userId,
        storeId: payload.storeId,
        completedAt,
        region,
      },
      { timeoutMs: 10_000 },
    );

    for (const item of payload.items ?? []) {
      const entityId = String(item.entityId ?? '').trim();
      if (!entityId) continue;
      const qty = Math.max(1, Number(item.quantity) || 1);
      const price = Number(item.price) || 0;
      const lineSpend = price * qty;

      if (item.itemType === 'drink') {
        await this.neo4j.runCypher(
          `
          MERGE (u:User {userId: $userId})
          MERGE (d:Drink {drinkId: $entityId})
          MERGE (s:Store {storeId: $storeId})
          MERGE (d)-[:SERVED_BY]->(s)
          MERGE (u)-[r:ORDERED]->(d)
          ON CREATE SET r.count = 0, r.totalSpent = 0
          SET r.count = r.count + $qty,
              r.lastAt = datetime($completedAt),
              r.totalSpent = coalesce(r.totalSpent, 0) + $lineSpend
          FOREACH (_ IN CASE WHEN $region IS NULL THEN [] ELSE [1] END |
            SET r.region = $region
          )
          `,
          {
            userId: payload.userId,
            storeId: payload.storeId,
            entityId,
            qty,
            lineSpend,
            completedAt,
            region,
          },
          { timeoutMs: 10_000 },
        );
      } else if (item.itemType === 'product') {
        await this.neo4j.runCypher(
          `
          MERGE (u:User {userId: $userId})
          MERGE (p:Product {productId: $entityId})
          MERGE (s:Store {storeId: $storeId})
          MERGE (p)-[:SERVED_BY]->(s)
          MERGE (u)-[r:ORDERED]->(p)
          ON CREATE SET r.count = 0, r.totalSpent = 0
          SET r.count = r.count + $qty,
              r.lastAt = datetime($completedAt),
              r.totalSpent = coalesce(r.totalSpent, 0) + $lineSpend
          FOREACH (_ IN CASE WHEN $region IS NULL THEN [] ELSE [1] END |
            SET r.region = $region
          )
          `,
          {
            userId: payload.userId,
            storeId: payload.storeId,
            entityId,
            qty,
            lineSpend,
            completedAt,
            region,
          },
          { timeoutMs: 10_000 },
        );
      }
    }

    if (totalSpent > 0) {
      await this.neo4j.runCypher(
        `
        MATCH (u:User {userId: $userId})
        SET u.spend30d = coalesce(u.spend30d, 0) + $totalSpent
        `,
        { userId: payload.userId, totalSpent },
        { timeoutMs: 5_000, op: 'order_spend' },
      );
    }

    // Phase 2 — FBT co-occurrence (paires de produits dans la même commande)
    const productIds = (payload.items ?? [])
      .filter((i) => i.itemType === 'product')
      .map((i) => String(i.entityId ?? '').trim())
      .filter(Boolean);
    const uniqueProducts = [...new Set(productIds)];
    for (let i = 0; i < uniqueProducts.length; i++) {
      for (let j = i + 1; j < uniqueProducts.length; j++) {
        const a = uniqueProducts[i]!;
        const b = uniqueProducts[j]!;
        const [lo, hi] = a < b ? [a, b] : [b, a];
        await this.neo4j.runCypher(
          `
          MERGE (pa:Product {productId: $a})
          MERGE (pb:Product {productId: $b})
          MERGE (pa)-[r:FREQUENTLY_BOUGHT_WITH]->(pb)
          ON CREATE SET r.score = 0
          SET r.score = r.score + 1, r.lastAt = datetime($completedAt)
          MERGE (pb)-[r2:FREQUENTLY_BOUGHT_WITH]->(pa)
          ON CREATE SET r2.score = 0
          SET r2.score = r2.score + 1, r2.lastAt = datetime($completedAt)
          `,
          { a: lo, b: hi, completedAt },
          { timeoutMs: 8_000, op: 'fbt_pair' },
        );
      }
    }

    // Phase 5 — tags dérivés du libellé ligne
    for (const item of payload.items ?? []) {
      if (item.itemType !== 'product') continue;
      const tags = deriveProductTagsFromText([
        item.label,
        item.categoryTitle,
      ]);
      if (!tags.length) continue;
      await this.applyProductTags({
        productId: item.entityId,
        tags,
      });
    }
  }

  async applySignalTracked(payload: GraphSignalTrackedPayload): Promise<void> {
    await this.ensureConstraints();
    const at = payload.at || new Date().toISOString();
    const refId = String(payload.refId ?? '').trim();
    if (!refId) return;

    if (payload.kind === 'search_query') {
      await this.neo4j.runCypher(
        `
        MERGE (u:User {userId: $userId})
        MERGE (t:SearchTerm {termId: $refId})
        ON CREATE SET t.term = $searchTerm
        SET t.term = coalesce($searchTerm, t.term)
        MERGE (u)-[r:SEARCHED]->(t)
        ON CREATE SET r.count = 0
        SET r.count = r.count + 1, r.lastAt = datetime($at)
        `,
        {
          userId: payload.userId,
          refId,
          searchTerm: payload.searchTerm ?? null,
          at,
        },
        { timeoutMs: 8_000 },
      );
      return;
    }

    if (payload.kind === 'store_view') {
      await this.neo4j.runCypher(
        `
        MERGE (u:User {userId: $userId})
        MERGE (s:Store {storeId: $refId})
        MERGE (u)-[r:VIEWED]->(s)
        ON CREATE SET r.count = 0
        SET r.count = r.count + 1, r.lastAt = datetime($at)
        `,
        { userId: payload.userId, refId, at },
        { timeoutMs: 8_000 },
      );
      return;
    }

    // product_view
    await this.neo4j.runCypher(
      `
      MERGE (u:User {userId: $userId})
      MERGE (p:Product {productId: $refId})
      MERGE (u)-[r:VIEWED]->(p)
      ON CREATE SET r.count = 0
      SET r.count = r.count + 1, r.lastAt = datetime($at)
      `,
      { userId: payload.userId, refId, at },
      { timeoutMs: 8_000 },
    );
  }

  async applyStoreSubscribed(
    payload: GraphStoreSubscribedPayload,
  ): Promise<void> {
    await this.ensureConstraints();
    const at = payload.at || new Date().toISOString();
    // Phase 6 — FOLLOWS = alias social de SUBSCRIBED_TO
    await this.neo4j.runCypher(
      `
      MERGE (u:User {userId: $userId})
      MERGE (s:Store {storeId: $storeId})
      MERGE (u)-[r:SUBSCRIBED_TO]->(s)
      SET r.at = datetime($at)
      MERGE (u)-[f:FOLLOWS]->(s)
      SET f.at = datetime($at)
      `,
      {
        userId: payload.userId,
        storeId: payload.storeId,
        at,
      },
      { timeoutMs: 8_000, op: 'store_subscribed' },
    );
  }

  async applyProductTags(payload: GraphProductTagsPayload): Promise<void> {
    await this.ensureConstraints();
    const productId = String(payload.productId ?? '').trim();
    const tags = (payload.tags ?? [])
      .map((t) => String(t ?? '').trim().toLowerCase())
      .filter(Boolean);
    if (!productId || !tags.length) return;
    for (const tag of tags) {
      await this.neo4j.runCypher(
        `
        MERGE (p:Product {productId: $productId})
        MERGE (t:Tag {slug: $tag})
        MERGE (p)-[:HAS_TAG]->(t)
        `,
        { productId, tag },
        { timeoutMs: 5_000, op: 'product_tag' },
      );
    }
    for (const ing of payload.ingredients ?? []) {
      const slug = String(ing ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .slice(0, 64);
      if (!slug) continue;
      await this.neo4j.runCypher(
        `
        MERGE (p:Product {productId: $productId})
        MERGE (i:Ingredient {slug: $slug})
        ON CREATE SET i.name = $name
        MERGE (p)-[:CONTAINS_INGREDIENT]->(i)
        `,
        { productId, slug, name: String(ing).trim() },
        { timeoutMs: 5_000, op: 'product_ingredient' },
      );
    }
  }

  /** Phase 6 — anneaux shipping_zones → Zone + DELIVERS_TO. */
  async applyStoreZones(payload: GraphStoreZonesPayload): Promise<void> {
    await this.ensureConstraints();
    const storeId = String(payload.storeId ?? '').trim();
    if (!storeId) return;
    const region = (payload.region ?? '').trim().toUpperCase() || null;
    await this.neo4j.runCypher(
      `
      MERGE (s:Store {storeId: $storeId})
      FOREACH (_ IN CASE WHEN $region IS NULL THEN [] ELSE [1] END |
        SET s.region = $region
      )
      `,
      { storeId, region },
      { timeoutMs: 5_000, op: 'store_zone_meta' },
    );
    for (const z of payload.zones ?? []) {
      const minD = Number(z.minDistance) || 0;
      const maxD = Number(z.maxDistance) || minD;
      const zoneId = zoneIdFromShippingRing(storeId, minD, maxD);
      await this.neo4j.runCypher(
        `
        MERGE (s:Store {storeId: $storeId})
        MERGE (z:Zone {zoneId: $zoneId})
        SET z.minKm = $minD, z.maxKm = $maxD, z.kind = 'shipping_ring'
        MERGE (s)-[r:DELIVERS_TO]->(z)
        SET r.updatedAt = datetime()
        `,
        { storeId, zoneId, minD, maxD },
        { timeoutMs: 5_000, op: 'store_delivers_to' },
      );
    }
  }

  /** Phase 2 — SIMILAR_TO produits via co-FBT. */
  async recomputeProductSimilarity(
    payload: GraphProductSimilarityPayload = {},
  ): Promise<{ pairs: number }> {
    await this.ensureConstraints();
    const minShared = Math.max(1, Number(payload.minShared) || 2);
    const rows = await this.neo4j.runCypher<{ pairs: number }>(
      `
      MATCH (a:Product)-[f:FREQUENTLY_BOUGHT_WITH]->(b:Product)
      WHERE a.productId < b.productId AND f.score >= $minShared
      MERGE (a)-[r:SIMILAR_TO]->(b)
      SET r.score = f.score, r.updatedAt = datetime(), r.source = 'fbt'
      MERGE (b)-[r2:SIMILAR_TO]->(a)
      SET r2.score = f.score, r2.updatedAt = datetime(), r2.source = 'fbt'
      RETURN count(*) AS pairs
      `,
      { minShared },
      { timeoutMs: 120_000, op: 'product_similar' },
    );
    const pairs = Number(rows[0]?.pairs ?? 0);
    this.logger.log(`SIMILAR_TO products recomputed pairs≈${pairs}`);
    return { pairs };
  }

  /**
   * Batch SIMILAR_TO stores (co-commande + co-abonnement).
   * Idempotent MERGE.
   */
  async recomputeStoreSimilarity(
    payload: GraphStoreSimilarityPayload = {},
  ): Promise<{ pairs: number }> {
    await this.ensureConstraints();
    const minShared = Math.max(1, Number(payload.minShared) || 2);

    const ordered = await this.neo4j.runCypher<{ pairs: number }>(
      `
      MATCH (a:Store)<-[:ORDERED_FROM]-(u:User)-[:ORDERED_FROM]->(b:Store)
      WHERE a.storeId < b.storeId
      WITH a, b, count(DISTINCT u) AS shared
      WHERE shared >= $minShared
      MERGE (a)-[r:SIMILAR_TO]->(b)
      SET r.score = shared, r.updatedAt = datetime(), r.source = 'co_order'
      MERGE (b)-[r2:SIMILAR_TO]->(a)
      SET r2.score = shared, r2.updatedAt = datetime(), r2.source = 'co_order'
      RETURN count(*) AS pairs
      `,
      { minShared },
      { timeoutMs: 120_000 },
    );

    const subscribed = await this.neo4j.runCypher<{ pairs: number }>(
      `
      MATCH (a:Store)<-[:SUBSCRIBED_TO]-(u:User)-[:SUBSCRIBED_TO]->(b:Store)
      WHERE a.storeId < b.storeId
      WITH a, b, count(DISTINCT u) AS shared
      WHERE shared >= $minShared
      MERGE (a)-[r:SIMILAR_TO]->(b)
      SET r.score = coalesce(r.score, 0) + shared,
          r.updatedAt = datetime(),
          r.source = coalesce(r.source, '') + '+co_sub'
      MERGE (b)-[r2:SIMILAR_TO]->(a)
      SET r2.score = coalesce(r2.score, 0) + shared,
          r2.updatedAt = datetime(),
          r2.source = coalesce(r2.source, '') + '+co_sub'
      RETURN count(*) AS pairs
      `,
      { minShared },
      { timeoutMs: 120_000 },
    );

    const pairs =
      Number(ordered[0]?.pairs ?? 0) + Number(subscribed[0]?.pairs ?? 0);
    this.logger.log(`SIMILAR_TO stores recomputed pairs≈${pairs}`);
    return { pairs };
  }
}
