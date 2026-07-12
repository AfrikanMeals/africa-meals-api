import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { shouldEnqueueGraphSync } from '@modules/graphdb-settings/graph-config.util';
import { GraphSyncQueueService } from './graph-sync-queue.service';

@Injectable()
export class GraphSimilarityCron {
  private readonly logger = new Logger(GraphSimilarityCron.name);

  constructor(private readonly queue: GraphSyncQueueService) {}

  /** Batch nocturne SIMILAR_TO stores (gated GRAPH_SYNC). */
  @Cron(process.env.GRAPH_STORE_SIMILARITY_CRON ?? '20 4 * * *')
  async recomputeStoreSimilarity(): Promise<void> {
    if (!shouldEnqueueGraphSync()) return;
    this.logger.log('Enqueue store SIMILAR_TO recompute');
    await this.queue.enqueueStoreSimilarityRecompute({ minShared: 2 });
  }

  /** Phase 2 — SIMILAR_TO produits via FBT. */
  @Cron(process.env.GRAPH_PRODUCT_SIMILARITY_CRON ?? '35 4 * * *')
  async recomputeProductSimilarity(): Promise<void> {
    if (!shouldEnqueueGraphSync()) return;
    this.logger.log('Enqueue product SIMILAR_TO recompute');
    await this.queue.enqueueProductSimilarityRecompute({ minShared: 2 });
  }
}
