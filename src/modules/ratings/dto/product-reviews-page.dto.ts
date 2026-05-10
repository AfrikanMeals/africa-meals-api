export type ProductReviewPublicRow = {
  id: string;
  rate: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  product: string;
  user: {
    id: string;
    fullName: string;
    profileImage: string | null;
  };
};

export type ProductReviewsPageResponse = {
  items: ProductReviewPublicRow[];
  total: number;
  page: number;
  take: number;
  hasMore: boolean;
};
