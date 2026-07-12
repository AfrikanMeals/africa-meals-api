/** Jobs BullMQ graph-sync (idempotents). */

export const GRAPH_JOB_ORDER_COMPLETED = 'graph.order.completed';
export const GRAPH_JOB_SIGNAL_TRACKED = 'graph.signal.tracked';
export const GRAPH_JOB_STORE_SUBSCRIBED = 'graph.store.subscribed';
export const GRAPH_JOB_RECOMPUTE_STORE_SIMILARITY =
  'graph.store.similarity.recompute';
export const GRAPH_JOB_RECOMPUTE_PRODUCT_SIMILARITY =
  'graph.product.similarity.recompute';
export const GRAPH_JOB_STORE_ZONES = 'graph.store.zones';
export const GRAPH_JOB_PRODUCT_TAGS = 'graph.product.tags';

export type GraphOrderLineItem = {
  entityId: string;
  itemType: 'product' | 'drink' | 'other';
  quantity: number;
  price?: number;
  /** Texte libre pour dériver tags knowledge (title/bio/fieldsets). */
  label?: string;
  categoryTitle?: string;
};

export type GraphOrderCompletedPayload = {
  orderId: string;
  userId: string;
  storeId: string;
  region?: string;
  currency?: string;
  totalSpent?: number;
  items: GraphOrderLineItem[];
  completedAt: string;
};

export type GraphSignalTrackedPayload = {
  userId: string;
  kind: 'product_view' | 'store_view' | 'search_query';
  refId: string;
  searchTerm?: string;
  at: string;
};

export type GraphStoreSubscribedPayload = {
  userId: string;
  storeId: string;
  at: string;
};

export type GraphStoreSimilarityPayload = {
  minShared?: number;
};

export type GraphProductSimilarityPayload = {
  minShared?: number;
};

export type GraphStoreZonesPayload = {
  storeId: string;
  region?: string;
  zones: Array<{ minDistance: number; maxDistance: number }>;
};

export type GraphProductTagsPayload = {
  productId: string;
  tags: string[];
  ingredients?: string[];
};
