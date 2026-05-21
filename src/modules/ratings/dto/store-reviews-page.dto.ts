import type { ProductReviewPublicRow } from './product-reviews-page.dto';

export type StoreReviewPublicRow = ProductReviewPublicRow & {
  productTitle: string;
};

export type StoreReviewsPageResponse = {
  items: StoreReviewPublicRow[];
  total: number;
  page: number;
  take: number;
  hasMore: boolean;
};
