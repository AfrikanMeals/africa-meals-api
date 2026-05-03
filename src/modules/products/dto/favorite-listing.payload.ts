/** Réponse minimale pour la liste favoris (GraphQL / agrégation). */
export type FavoriteCategoryListingPayload = {
  id: string;
  title: string;
  icon: string;
  isEnabled: boolean;
};

export type FavoriteStoreListingPayload = {
  id: string;
  name: string;
  status: string;
};

export type FavoriteProductListingPayload = {
  id: string;
  title: string;
  profileImage: string;
  price: number;
  discountPrice: number;
  currency: string;
  bio: string;
  originCountry: string;
  likesCount: number;
  averageRating: number;
  inCart: boolean;
  category: FavoriteCategoryListingPayload | null;
  store: FavoriteStoreListingPayload | null;
};

export type FavoriteListingPagePayload = {
  items: FavoriteProductListingPayload[];
  total: number;
  page: number;
  limit: number;
};
