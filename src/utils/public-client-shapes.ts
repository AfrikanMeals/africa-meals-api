/**
 * Réponses JSON allégées pour app / GraphQL (accueil, listes publiques).
 * Évite d’exposer tout le document Mongo (versions internes, relations lourdes).
 */

export function mongoIdToString(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'toString' in (v as object)) {
    return (v as { toString: () => string }).toString();
  }
  return String(v);
}

function slimAnnouncementConfig(cfg: unknown): Record<string, unknown> {
  if (!cfg || typeof cfg !== 'object') {
    return {
      navigationType: 'internal',
      url: '',
      query: {
        searchContent: 'products',
        storeId: null,
        categoryId: null,
        producId: null,
        id: '',
      },
      style: { colors: [] as string[], id: '' },
    };
  }
  const c = cfg as Record<string, unknown>;
  const q = (c['query'] ?? c['Query']) as Record<string, unknown> | undefined;
  const s = (c['style'] ?? c['Style']) as Record<string, unknown> | undefined;
  const queryOut: Record<string, unknown> = {};
  if (q && typeof q === 'object') {
    queryOut['searchContent'] =
      q['searchContent'] ?? q['search_content'] ?? 'products';
    queryOut['storeId'] = q['storeId'] ?? q['store_id'] ?? null;
    queryOut['categoryId'] = q['categoryId'] ?? q['category_id'] ?? null;
    queryOut['producId'] = q['producId'] ?? q['product_id'] ?? null;
    queryOut['id'] = mongoIdToString(q['id'] ?? q['_id']);
  }
  const styleOut: Record<string, unknown> = { colors: [] as string[], id: '' };
  if (s && typeof s === 'object') {
    const colors = s['colors'];
    styleOut['colors'] = Array.isArray(colors) ? colors : [];
    styleOut['id'] = mongoIdToString(s['id'] ?? s['_id']);
  }
  return {
    navigationType: c['navigationType'] ?? c['navigation_type'] ?? 'internal',
    url: c['url'] != null ? String(c['url']) : '',
    query: queryOut,
    style: styleOut,
  };
}

/** Aligné sur le client mobile + admin. */
export function slimAnnouncementForClient(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const id = mongoIdToString(raw['id'] ?? raw['_id']);
  const createdAt = raw['createdAt'] ?? raw['created_at'];
  const updatedAt = raw['updatedAt'] ?? raw['updated_at'];
  const storeId = mongoIdToString(raw['store'] ?? raw['storeId'] ?? '');
  const productId = mongoIdToString(raw['product'] ?? raw['productId'] ?? '');
  return {
    id,
    isActive: raw['isActive'] ?? raw['is_active'] ?? false,
    text: String(raw['text'] ?? ''),
    subtitle: String(raw['subtitle'] ?? ''),
    actionText: String(raw['actionText'] ?? raw['action_text'] ?? ''),
    sortOrder: Number(raw['sortOrder'] ?? raw['sort_order'] ?? 0),
    region: raw['region'] != null ? String(raw['region']) : undefined,
    validFrom:
      raw['validFrom'] != null || raw['valid_from'] != null
        ? String(raw['validFrom'] ?? raw['valid_from'])
        : undefined,
    validUntil:
      raw['validUntil'] != null || raw['valid_until'] != null
        ? String(raw['validUntil'] ?? raw['valid_until'])
        : undefined,
    audienceType: String(
      raw['audienceType'] ?? raw['audience_type'] ?? 'ALL',
    ),
    audienceUserIds: Array.isArray(raw['audienceUserIds'] ?? raw['audience_user_ids'])
      ? (raw['audienceUserIds'] ?? raw['audience_user_ids']).map((v) =>
          mongoIdToString(v),
        )
      : [],
    placements: Array.isArray(raw['placements']) ? raw['placements'] : [],
    actionType: raw['actionType'] ?? raw['action_type'] ?? undefined,
    actionTarget: raw['actionTarget'] ?? raw['action_target'] ?? undefined,
    ...(storeId ? { storeId } : {}),
    ...(productId ? { productId } : {}),
    dismissible: raw['dismissible'] !== false,
    ...(raw['pictureUrl'] != null || raw['picture_url'] != null
      ? {
          pictureUrl: String(raw['pictureUrl'] ?? raw['picture_url']),
        }
      : {}),
    ...(raw['config'] != null
      ? { config: slimAnnouncementConfig(raw['config']) }
      : {}),
    createdAt:
      createdAt instanceof Date
        ? createdAt.toISOString()
        : String(createdAt ?? new Date().toISOString()),
    updatedAt:
      updatedAt instanceof Date
        ? updatedAt.toISOString()
        : String(updatedAt ?? new Date().toISOString()),
  };
}

/** Aligné sur `AdEntity.fromJson` (mobile) — pas d’objet `store` / `product` embarqué. */
export function slimAdForPublicClient(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const id = mongoIdToString(raw['_id'] ?? raw['id']);
  const storeRaw = raw['store'];
  let storeId: string | undefined;
  let storeName: string | undefined;
  let storeProfileImageUrl: string | undefined;
  if (
    storeRaw != null &&
    typeof storeRaw === 'object' &&
    !(storeRaw instanceof Date)
  ) {
    const st = storeRaw as Record<string, unknown>;
    storeId = mongoIdToString(st['_id'] ?? st['id']);
    if (storeId === '') storeId = undefined;
    if (st['name'] != null) storeName = String(st['name']);
    if (st['profileImage'] != null || st['profile_image'] != null) {
      storeProfileImageUrl = String(
        st['profileImage'] ?? st['profile_image'] ?? '',
      );
    }
  }
  const productRaw = raw['product'];
  let productId = mongoIdToString(
    raw['productId'] ?? raw['product_id'] ?? '',
  );
  if (productId === '') productId = undefined;
  if (productRaw != null) {
    if (
      typeof productRaw === 'object' &&
      !(productRaw instanceof Date)
    ) {
      const fromRef = mongoIdToString(
        (productRaw as Record<string, unknown>)['_id'] ??
          (productRaw as Record<string, unknown>)['id'],
      );
      if (fromRef !== '') productId = fromRef;
    } else {
      const fromRef = mongoIdToString(productRaw);
      if (fromRef !== '') productId = fromRef;
    }
  }
  return {
    _id: id,
    id,
    isActive: raw['isActive'] ?? raw['is_active'] ?? true,
    title: String(raw['title'] ?? ''),
    subtitle: String(raw['subtitle'] ?? ''),
    actionText: String(raw['actionText'] ?? raw['action_text'] ?? ''),
    imageUrl: (raw['imageUrl'] ?? raw['image_url']) as
      | string
      | null
      | undefined,
    sortOrder: Number(raw['sortOrder'] ?? raw['sort_order'] ?? 0),
    ...(storeId != null ? { storeId } : {}),
    ...(storeName != null ? { storeName } : {}),
    ...(storeProfileImageUrl != null && storeProfileImageUrl !== ''
      ? { storeProfileImageUrl }
      : {}),
    ...(productId != null ? { productId } : {}),
    actionType: raw['actionType'] ?? raw['action_type'],
    actionTarget: raw['actionTarget'] ?? raw['action_target'],
  };
}

/** Liste catégories : champs utiles catalogue (`ProductCategorie` mobile). */
export function slimProductCategoryForPublicClient(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const id = mongoIdToString(row['id'] ?? row['_id']);
  return {
    id,
    _id: id,
    title: String(row['title'] ?? ''),
    icon: String(row['icon'] ?? ''),
    ...(typeof row['image'] === 'string' && row['image'].trim()
      ? { image: row['image'].trim() }
      : {}),
    kind: row['kind'] === 'drink' ? 'drink' : 'food',
    isEnabled: row['isEnabled'] ?? row['is_enabled'] ?? true,
    productCount: Number(row['productCount'] ?? row['product_count'] ?? 0),
  };
}
