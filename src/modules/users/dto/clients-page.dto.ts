export type EndUserClientRow = {
  id: string;
  fullName: string;
  prenom: string;
  nom: string;
  email: string;
  appCountryCode: string;
  loyaltyPoints: number;
  rewardProgramEligible: boolean;
  createdAt: string;
  addressSummary: string;
  emailVerified: boolean;
  ordersCount: number;
  totalSpent: number;
  profileImage: string | null;
};

export type EndUserClientsPageResponse = {
  items: EndUserClientRow[];
  total: number;
  page: number;
  take: number;
  hasMore: boolean;
};

export function parseClientsPageQuery(
  pageRaw?: string,
  takeRaw?: string,
): { page: number; take: number } {
  const pageNum = pageRaw != null ? Number(pageRaw) : 1;
  const takeNum = takeRaw != null ? Number(takeRaw) : 20;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
  const take = Number.isFinite(takeNum) && takeNum >= 1 ? Math.min(100, Math.floor(takeNum)) : 20;
  return { page, take };
}

export function paginateClientRows(
  rows: EndUserClientRow[],
  page: number,
  take: number,
): EndUserClientsPageResponse {
  const total = rows.length;
  const skip = (page - 1) * take;
  const items = rows.slice(skip, skip + take);
  const hasMore = skip + items.length < total;
  return { items, total, page, take, hasMore };
}
