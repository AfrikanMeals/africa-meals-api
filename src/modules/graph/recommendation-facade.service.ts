import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  isRecoGraphEnabled,
  parseRecoGraphTimeoutMs,
  shouldUseGraphRecommendations,
} from '@modules/graphdb-settings/graph-config.util';
import { GraphMetricsService } from '@modules/neo4j/graph-metrics.service';
import { Neo4jService } from '@modules/neo4j/neo4j.service';
import { GraphRecommendationService } from './graph-recommendation.service';
import { mergeGraphIdLists } from './reco-score-blend.util';

/**
 * Orchestration reco : Neo4j si healthy + flags runtime Admin, sinon null (Mongo).
 */
@Injectable()
export class RecommendationFacade {
  private readonly logger = new Logger(RecommendationFacade.name);

  constructor(
    private readonly neo4j: Neo4jService,
    private readonly graphReco: GraphRecommendationService,
    @Optional() private readonly metrics?: GraphMetricsService,
  ) {}

  /** Gate commun flags + health (fail-open → false). */
  private async _graphReady(
    fallbackReason: string,
  ): Promise<{ ok: true; timeoutMs: number } | { ok: false }> {
    if (!isRecoGraphEnabled()) {
      this.metrics?.recordRecoFallback(fallbackReason);
      return { ok: false };
    }
    let neo4jHealthy = false;
    try {
      neo4jHealthy = await this.neo4j.ensureHealthy();
    } catch {
      neo4jHealthy = false;
    }
    if (!shouldUseGraphRecommendations({ neo4jHealthy })) {
      this.metrics?.recordRecoFallback(
        neo4jHealthy ? 'gate' : 'neo4j_unhealthy',
      );
      return { ok: false };
    }
    return { ok: true, timeoutMs: parseRecoGraphTimeoutMs() };
  }

  private async _raceOrNull<T>(
    work: Promise<T>,
    timeoutMs: number,
    onError: string,
  ): Promise<T | null> {
    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('reco_graph_timeout')), timeoutMs),
        ),
      ]);
      this.metrics?.recordRecoHit();
      return result;
    } catch (err) {
      this.metrics?.recordRecoFallback(
        err instanceof Error ? err.message : onError,
      );
      this.logger.debug(
        `graph reco fail-open: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  async personalizedStoreIdsOrNull(opts: {
    userId?: string | null;
    region?: string;
    limit?: number;
  }): Promise<string[] | null> {
    const userId = String(opts.userId ?? '').trim();
    if (!userId) return null;
    const gate = await this._graphReady('reco_flag_off');
    if (!gate.ok) return null;

    return this._raceOrNull(
      this.graphReco.personalizedStoreIds(
        userId,
        opts.region ?? '',
        opts.limit ?? 12,
      ),
      gate.timeoutMs,
      'error',
    );
  }

  /**
   * Produits personnalisés (FBT + SIMILAR_TO + collab) pour blend feed / push / ads.
   */
  async personalizedProductIdsOrNull(opts: {
    userId?: string | null;
    region?: string;
    limit?: number;
  }): Promise<string[] | null> {
    const userId = String(opts.userId ?? '').trim();
    if (!userId) return null;
    const gate = await this._graphReady('products_flag_off');
    if (!gate.ok) return null;

    // region réservé (filtrage Mongo côté appelant) — Cypher produit actuel sans region
    void opts.region;
    return this._raceOrNull(
      this.graphReco.personalizedProductIds(userId, opts.limit ?? 24),
      gate.timeoutMs,
      'products_error',
    );
  }

  async personalizedFbtProductIdsOrNull(opts: {
    userId?: string | null;
    limit?: number;
  }): Promise<string[] | null> {
    const userId = String(opts.userId ?? '').trim();
    if (!userId) return null;
    const gate = await this._graphReady('fbt_flag_off');
    if (!gate.ok) return null;
    try {
      const ids = await this.graphReco.personalizedFbtProductIds(
        userId,
        opts.limit ?? 12,
      );
      if (ids.length) this.metrics?.recordRecoHit();
      return ids;
    } catch (err) {
      this.metrics?.recordRecoFallback('fbt_error');
      this.logger.debug(
        `FBT fail-open: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Boutiques qui desservent une zone (DELIVERS_TO) — null si graphe off. */
  async storeIdsDeliveringToZoneOrNull(opts: {
    zoneId?: string | null;
    limit?: number;
  }): Promise<string[] | null> {
    const zoneId = String(opts.zoneId ?? '').trim();
    if (!zoneId) return null;
    const gate = await this._graphReady('zone_flag_off');
    if (!gate.ok) return null;
    return this._raceOrNull(
      this.graphReco.storeIdsDeliveringToZone(zoneId, opts.limit ?? 24),
      gate.timeoutMs,
      'zone_error',
    );
  }

  /**
   * IDs produits related aplatis (FBT puis similar) — contrat stable mobile/feed.
   */
  async relatedProductIdsOrNull(opts: {
    productId: string;
    limit?: number;
  }): Promise<string[] | null> {
    const related = await this.relatedProductsOrNull(opts);
    if (!related) return null;
    const fbt = related.frequentlyBoughtWith.map((r) => r.productId);
    const similar = related.similar.map((r) => r.productId);
    return mergeGraphIdLists([fbt, similar], opts.limit ?? 16);
  }

  async relatedProductsOrNull(opts: {
    productId: string;
    limit?: number;
  }): Promise<{
    frequentlyBoughtWith: Array<{ productId: string; score: number }>;
    similar: Array<{ productId: string; score: number }>;
  } | null> {
    const gate = await this._graphReady('related_flag_off');
    if (!gate.ok) return null;
    const limit = opts.limit ?? 8;
    try {
      const [frequentlyBoughtWith, similar] = await Promise.all([
        this.graphReco.frequentlyBoughtWith(opts.productId, limit),
        this.graphReco.similarProductIds(opts.productId, limit),
      ]);
      this.metrics?.recordRecoHit();
      return { frequentlyBoughtWith, similar };
    } catch {
      this.metrics?.recordRecoFallback('related_error');
      return null;
    }
  }

  async knowledgeProductIdsOrNull(opts: {
    tag: string;
    region?: string;
    limit?: number;
  }): Promise<string[] | null> {
    const gate = await this._graphReady('knowledge_flag_off');
    if (!gate.ok) return null;
    try {
      return await this.graphReco.productIdsByTag(
        opts.tag,
        opts.region ?? '',
        opts.limit ?? 24,
      );
    } catch {
      this.metrics?.recordRecoFallback('knowledge_error');
      return null;
    }
  }
}
