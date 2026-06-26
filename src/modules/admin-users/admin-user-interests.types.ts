export type AdminUserInterestProductRef = {
  id: string;
  title: string;
  storeName: string | null;
};

export type AdminUserInterestStoreRef = {
  id: string;
  name: string;
};

export type AdminUserInterestSignalRow = {
  kind: string;
  label: string;
  searchTerm: string | null;
  createdAt: string | null;
};

export type AdminUserInterestOrderCategoryRow = {
  category: string;
  count: number;
};

export type AdminUserInterestOrderedProductRow = {
  entityId: string | null;
  label: string;
  count: number;
};

export type AdminUserInterestsResponse = {
  user: {
    id: string;
    fullName: string;
    email: string;
    type: string;
    appCountryCode: string | null;
  };
  adsTargeting: {
    segment: string;
    topCategories: string[];
    interestScores: Record<string, number>;
    engagementRate: number;
    conversionProbability: number;
    sessions30d: number;
    lastActive: string | null;
    lastComputedAt: string | null;
    country: string | null;
    language: string | null;
  } | null;
  recommendationDigest: {
    computedAt: string | null;
    topSearchTerms: string[];
  } | null;
  topViewedProducts: AdminUserInterestProductRef[];
  topViewedStores: AdminUserInterestStoreRef[];
  recentSignals: AdminUserInterestSignalRow[];
  orderInsights: {
    totalOrders: number;
    lastOrderAt: string | null;
    topCategories: AdminUserInterestOrderCategoryRow[];
    topProducts: AdminUserInterestOrderedProductRow[];
  };
};
