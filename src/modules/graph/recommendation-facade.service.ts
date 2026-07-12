import { Injectable, Logger } from '@nestjs/common';
import {
  isRecoGraphEnabled,
  parseRecoGraphTimeoutMs,
  shouldUseGraphRecommendations,
} from '@modules/graphdb-settings/graph-config.util';
import { Neo4jService } from '@modules/neo4j/neo4j.service';
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
  ) {}

  /**
   * @returns storeIds Neo4j ou `null` pour fail-open Mongo.
   */
  async personalizedStoreIdsOrNull(opts: {
    userId?: string | null;
    region?: string;
    limit?: number;
  }): Promise<string[] | null> {
    const userId = String(opts.userId ?? '').trim();
    if (!userId) return null;

    // Flags Admin/env d’abord — évite d’ouvrir le driver si reco off.
    if (!isRecoGraphEnabled()) return null;

    let neo4jHealthy = false;
    try {
      neo4jHealthy = await this.neo4j.ensureHealthy();
    } catch {
      neo4jHealthy = false;
    }

    if (!shouldUseGraphRecommendations({ neo4jHealthy })) {
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
      return ids;
    } catch (err) {
      this.logger.debug(
        `graph reco fail-open: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
