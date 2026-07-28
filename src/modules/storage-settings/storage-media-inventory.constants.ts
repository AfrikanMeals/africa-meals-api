/** Collections MongoDB et champs URL médias à migrer entre moteurs. */
export type StorageMediaScalarField = {
  kind: 'scalar';
  field: string;
};

export type StorageMediaArrayField = {
  kind: 'array';
  arrayField: string;
  urlField: string;
};

/** Tableau d'URLs brutes (ex. `pending_delivery_proofs.proof_photo_urls`). */
export type StorageMediaStringArrayField = {
  kind: 'stringArray';
  field: string;
};

export type StorageMediaField =
  | StorageMediaScalarField
  | StorageMediaArrayField
  | StorageMediaStringArrayField;

export type StorageMediaTarget = {
  collection: string;
  fields: StorageMediaField[];
};

export const STORAGE_MEDIA_TARGETS: StorageMediaTarget[] = [
  {
    collection: 'products',
    fields: [
      { kind: 'scalar', field: 'profile_image' },
      { kind: 'array', arrayField: 'gallery_images', urlField: 'imageUrl' },
    ],
  },
  {
    collection: 'stores',
    fields: [{ kind: 'scalar', field: 'profile_image' }],
  },
  {
    collection: 'users',
    fields: [{ kind: 'scalar', field: 'profile_image' }],
  },
  {
    collection: 'offers',
    fields: [{ kind: 'scalar', field: 'profile_image' }],
  },
  {
    collection: 'drinks',
    fields: [{ kind: 'scalar', field: 'imageUrl' }],
  },
  {
    collection: 'ads',
    fields: [{ kind: 'scalar', field: 'imageUrl' }],
  },
  {
    collection: 'gift_codes',
    fields: [{ kind: 'scalar', field: 'imageUrl' }],
  },
  {
    collection: 'announcements',
    fields: [{ kind: 'scalar', field: 'picture_url' }],
  },
  {
    collection: 'app_policies',
    fields: [{ kind: 'scalar', field: 'imageUrl' }],
  },
  {
    collection: 'vendor_guides',
    fields: [{ kind: 'scalar', field: 'imageUrl' }],
  },
  {
    collection: 'platform_theme_settings',
    fields: [
      { kind: 'scalar', field: 'appLogoUrl' },
      { kind: 'scalar', field: 'adminLogoUrl' },
      { kind: 'scalar', field: 'mobileTabBackgroundLightUrl' },
      { kind: 'scalar', field: 'mobileTabBackgroundDarkUrl' },
    ],
  },
  {
    collection: 'blog_articles',
    fields: [{ kind: 'scalar', field: 'featuredImageUrl' }],
  },
  // Illustration des catégories catalogue (upload admin `catalog/categories`).
  {
    collection: 'product_categories',
    fields: [{ kind: 'scalar', field: 'image' }],
  },
  // Suppléments produit (upload vendeur `stores/{id}/extras/{productId}`).
  {
    collection: 'product_extras',
    fields: [{ kind: 'scalar', field: 'profile_image' }],
  },
  // Preuves photo de dépôt client absent (upload livreur `delivery-proof/`).
  {
    collection: 'pending_delivery_proofs',
    fields: [{ kind: 'stringArray', field: 'proof_photo_urls' }],
  },
];
