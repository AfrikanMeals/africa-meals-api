import { Injectable, Logger } from '@nestjs/common';
import {
  isRecoGraphEnabled,
  parseRecoGraphTimeoutMs,
  shouldUseGraphRecommendations,
} from '@modules/graphdb-settings/graph-config.util';
import { GraphMetricsService } from '@modules/neo4j/graph-metrics.service';
import { Neo4jService } from '@modules/neo4j/neo4j.service';
import { Optional } from '@nestjs/common';
import { GraphRecommendationService } from './graph-recommendation.service';

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

  async personalizedStoreIdsOrNull(opts: {
    userId?: string | null;
    region?: string;
    limit?: number;
  }): Promise<string[] | null> {
    const userId = String(opts.userId ?? '').trim();
    if (!userId) return null;
    if (!isRecoGraphEnabled()) {
      this.metrics?.recordRecoFallback('reco_flag_off');
      return null;
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
      return null;
    }

    const timeoutMs = parseRecoGraphTimeoutMs();
    try {
      const ids = await Promise.race([
        this.graphReco.personalizedStoreIds(
          userId,
          opts.region ?? '',
          opts.limit ?? 12,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('reco_graph_timeout')),
            timeoutMs,
          ),
        ),
      ]);
      this.metrics?.recordRecoHit();
      return ids;
    } catch (err) {
      this.metrics?.recordRecoFallback(
        err instanceof Error ? err.message : 'error',
      );
      this.logger.debug(
        `graph reco fail-open: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  async personalizedFbtProductIdsOrNull(opts: {
    userId?: string | null;
    limit?: number;
  }): Promise<string[] | null> {
    const userId = String(opts.userId ?? '').trim();
    if (!userId || !isRecoGraphEnabled()) return null;
    const healthy = await this.neo4j.ensureHealthy().catch(() => false);
    if (!shouldUseGraphRecommendations({ neo4jHealthy: healthy })) {
      this.metrics?.recordRecoFallback('fbt_unhealthy');
      return null;
    }
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

  async relatedProductsOrNull(opts: {
    productId: string;
    limit?: number;
  }): Promise<{
    frequentlyBoughtWith: Array<{ productId: string; score: number }>;
    similar: Array<{ productId: string; score: number }>;
  } | null> {
    if (!isRecoGraphEnabled()) return null;
    const healthy = await this.neo4j.ensureHealthy().catch(() => false);
    if (!shouldUseGraphRecommendations({ neo4jHealthy: healthy })) return null;
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
    if (!isRecoGraphEnabled()) return null;
    const healthy = await this.neo4j.ensureHealthy().catch(() => false);
    if (!shouldUseGraphRecommendations({ neo4jHealthy: healthy })) return null;
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
