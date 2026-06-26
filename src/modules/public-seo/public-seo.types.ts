export type SeoSitemapStoreRow = {
  id: string;
  name: string;
  bio?: string | null;
  profileImage?: string | null;
  updatedAt?: string;
};

export type SeoSitemapProductRow = {
  id: string;
  storeId: string;
  storeName?: string;
  title: string;
  about?: string | null;
  profileImage?: string | null;
  updatedAt?: string;
};

export type SeoSitemapDrinkRow = {
  id: string;
  storeId: string;
  storeName?: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  updatedAt?: string;
};

export type SeoSitemapPageResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
