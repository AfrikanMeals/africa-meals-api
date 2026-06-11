export type SeoSitemapStoreRow = {
  id: string;
  name: string;
  updatedAt?: string;
};

export type SeoSitemapProductRow = {
  id: string;
  storeId: string;
  title: string;
  updatedAt?: string;
};

export type SeoSitemapPageResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
