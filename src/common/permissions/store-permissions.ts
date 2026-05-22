/** Permissions boutique (équipe vendeur). */
export const STORE_PERMISSIONS = [
  'dashboard.view',
  'catalog.view',
  'catalog.edit',
  'orders.view',
  'orders.manage',
  'customers.view',
  'finances.view',
  'marketing.view',
  'coupons.manage',
  'promotions.manage',
  'team.view',
  'team.manage',
  'settings.view',
  'settings.edit',
  'chat.view',
] as const;

export type StorePermission = (typeof STORE_PERMISSIONS)[number];

export const STORE_PERMISSION_LABELS: Record<StorePermission, string> = {
  'dashboard.view': 'Tableau de bord',
  'catalog.view': 'Catalogue (lecture)',
  'catalog.edit': 'Catalogue (modification)',
  'orders.view': 'Commandes (lecture)',
  'orders.manage': 'Commandes (gestion)',
  'customers.view': 'Clients',
  'finances.view': 'Finances',
  'marketing.view': 'Marketing',
  'coupons.manage': 'Coupons',
  'promotions.manage': 'Promotions',
  'team.view': 'Équipe (lecture)',
  'team.manage': 'Équipe (gestion)',
  'settings.view': 'Paramètres (lecture)',
  'settings.edit': 'Paramètres (modification)',
  'chat.view': 'Messagerie / chat',
};

export const ALL_STORE_PERMISSIONS: StorePermission[] = [
  ...STORE_PERMISSIONS,
];

/** Ordre d’affichage des rôles système prédéfinis. */
export const STORE_ROLE_TEMPLATE_ORDER = [
  'OWNER',
  'MANAGER',
  'SUPPORT',
  'MODERATOR',
  'ACCOUNTANT',
  'MARKETER',
] as const;

export type StoreRoleTemplateKey = (typeof STORE_ROLE_TEMPLATE_ORDER)[number];

export const DEFAULT_STORE_ROLE_TEMPLATES: Array<{
  key: StoreRoleTemplateKey;
  name: string;
  description: string;
  permissions: StorePermission[];
  isOwner?: boolean;
}> = [
  {
    key: 'OWNER',
    name: 'Owner',
    description: 'Propriétaire — accès complet à la boutique',
    permissions: ALL_STORE_PERMISSIONS,
    isOwner: true,
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Shop Manager — gestion quotidienne (sous le propriétaire)',
    permissions: ALL_STORE_PERMISSIONS.filter(
      (p) => p !== 'team.manage' && p !== 'settings.edit',
    ),
  },
  {
    key: 'SUPPORT',
    name: 'Support',
    description: 'Messenger — messagerie, commandes et clients',
    permissions: [
      'dashboard.view',
      'orders.view',
      'orders.manage',
      'customers.view',
      'chat.view',
    ],
  },
  {
    key: 'MODERATOR',
    name: 'Moderator',
    description: 'Catalog — catalogue et offres',
    permissions: [
      'dashboard.view',
      'catalog.view',
      'catalog.edit',
      'marketing.view',
    ],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Finance — finances et suivi des commandes',
    permissions: [
      'dashboard.view',
      'orders.view',
      'customers.view',
      'finances.view',
    ],
  },
  {
    key: 'MARKETER',
    name: 'Marketer',
    description: 'Marketing — promotions, coupons et visibilité',
    permissions: [
      'dashboard.view',
      'marketing.view',
      'coupons.manage',
      'promotions.manage',
      'catalog.view',
    ],
  },
];

export function isStorePermission(value: string): value is StorePermission {
  return (STORE_PERMISSIONS as readonly string[]).includes(value);
}

export function sortStoreRolesByTemplate<
  T extends {
    templateKey?: string | null;
    isOwnerRole?: boolean;
    name?: string;
    isSystem?: boolean;
  },
>(roles: T[]): T[] {
  const order = new Map(
    STORE_ROLE_TEMPLATE_ORDER.map((k, i) => [k, i] as const),
  );
  return [...roles].sort((a, b) => {
    if (a.isOwnerRole) return -1;
    if (b.isOwnerRole) return 1;
    const ak = a.templateKey ?? '';
    const bk = b.templateKey ?? '';
    const aPredefined = order.has(ak as StoreRoleTemplateKey);
    const bPredefined = order.has(bk as StoreRoleTemplateKey);
    if (aPredefined && bPredefined) {
      return (
        order.get(ak as StoreRoleTemplateKey)! -
        order.get(bk as StoreRoleTemplateKey)!
      );
    }
    if (aPredefined) return -1;
    if (bPredefined) return 1;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}
