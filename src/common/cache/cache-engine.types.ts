export type CacheEngine = 'redis' | 'memcached' | 'memory';

export type AppCacheModuleKey =
  | 'publicCatalog'
  | 'favorites'
  | 'productCategories'
  | 'checkoutPreview'
  | 'fieldProjection'
  | 'recommendations';

export const APP_CACHE_MODULE_KEYS: AppCacheModuleKey[] = [
  'publicCatalog',
  'favorites',
  'productCategories',
  'checkoutPreview',
  'fieldProjection',
  'recommendations',
];

export type ModuleEngineMap = Record<AppCacheModuleKey, CacheEngine>;

export const DEFAULT_MODULE_ENGINES: ModuleEngineMap = {
  publicCatalog: 'redis',
  favorites: 'redis',
  productCategories: 'redis',
  checkoutPreview: 'redis',
  fieldProjection: 'redis',
  recommendations: 'redis',
};

export type CacheEngineAvailability = {
  redis: boolean;
  memcached: boolean;
  memory: true;
};

export const CACHE_MODULE_LABELS: Record<
  AppCacheModuleKey,
  { label: string; description: string }
> = {
  publicCatalog: {
    label: 'Catalogue public',
    description: 'Menus boutique, recherche, accueil, détail produit, annonces.',
  },
  favorites: {
    label: 'Favoris',
    description: 'Listes de produits favoris (REST et GraphQL).',
  },
  productCategories: {
    label: 'Catégories produits',
    description: 'Liste publique des catégories produits.',
  },
  checkoutPreview: {
    label: 'Preview panier / checkout',
    description: 'Calcul pricing panier et checkout groupé.',
  },
  fieldProjection: {
    label: 'Projection de champs',
    description: 'Cache des réponses GET filtrées (`fields`, `include`, etc.).',
  },
  recommendations: {
    label: 'Recommandations',
    description:
      'Feed reco (Mongo aujourd’hui, Neo4j plus tard) — hit/miss/backfill.',
  },
};
