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

export type StorageMediaTarget = {
  collection: string;
  fields: Array<StorageMediaScalarField | StorageMediaArrayField>;
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
];
