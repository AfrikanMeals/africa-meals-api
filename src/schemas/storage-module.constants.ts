export type StorageModuleEngineSetting =
  | 'default'
  | 'firebase'
  | 'gcs'
  | 's3'
  | 'minio'
  | 'r2'
  | 'vercelBlob'
  | 'auto';

export const STORAGE_MODULES = [
  'catalog',
  'profile',
  'marketing',
  'chat',
  'system',
] as const;

export type StorageModuleId = (typeof STORAGE_MODULES)[number];

export type StorageModuleEngines = Record<
  StorageModuleId,
  StorageModuleEngineSetting
>;

export const DEFAULT_MODULE_STORAGE_ENGINES: StorageModuleEngines = {
  catalog: 'default',
  profile: 'default',
  marketing: 'default',
  chat: 'default',
  system: 'default',
};

export const STORAGE_MODULE_LABELS: Record<
  StorageModuleId,
  { title: string; description: string }
> = {
  catalog: {
    title: 'Catalogue',
    description: 'Plats, boissons, catégories et extras boutique.',
  },
  profile: {
    title: 'Profil',
    description: 'Photos de profil boutique et utilisateur.',
  },
  marketing: {
    title: 'Marketing',
    description: 'Publicités, codes cadeaux et offres boutique.',
  },
  chat: {
    title: 'Chat',
    description: 'Messages vocaux et pièces jointes de conversation.',
  },
  system: {
    title: 'Système',
    description: 'Annonces, documents légaux et assets e-mail.',
  },
};

/** Déduit le module stockage à partir du chemin d’upload (`basePath`). */
export function inferStorageModuleFromBasePath(
  basePath: string,
): StorageModuleId {
  const normalized = basePath.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!normalized) return 'catalog';

  if (
    normalized.startsWith('marketing/') ||
    normalized.includes('/offers')
  ) {
    return 'marketing';
  }

  if (
    normalized.startsWith('announcements') ||
    normalized.startsWith('legal/') ||
    normalized.startsWith('email-heroes/')
  ) {
    return 'system';
  }

  if (
    normalized.startsWith('users/') &&
    (normalized.includes('/chat-voice') || normalized.includes('/chat-media'))
  ) {
    return 'chat';
  }

  if (
    normalized.startsWith('users/') && normalized.includes('/profile')
  ) {
    return 'profile';
  }

  if (
    normalized.startsWith('stores/') && normalized.includes('/profile')
  ) {
    return 'profile';
  }

  if (
    normalized.startsWith('catalog/') ||
    normalized.includes('/products') ||
    normalized.includes('/drinks') ||
    normalized.includes('/extras') ||
    normalized.includes('/categories')
  ) {
    return 'catalog';
  }

  return 'catalog';
}

export function normalizeModuleStorageEngines(
  raw: unknown,
): StorageModuleEngines {
  const o =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const validModes: StorageModuleEngineSetting[] = [
    'default',
    'firebase',
    'gcs',
    's3',
    'minio',
    'r2',
    'vercelBlob',
    'auto',
  ];
  const result = { ...DEFAULT_MODULE_STORAGE_ENGINES };
  for (const module of STORAGE_MODULES) {
    const value = o[module];
    if (
      typeof value === 'string' &&
      validModes.includes(value as StorageModuleEngineSetting)
    ) {
      result[module] = value as StorageModuleEngineSetting;
    }
  }
  return result;
}
