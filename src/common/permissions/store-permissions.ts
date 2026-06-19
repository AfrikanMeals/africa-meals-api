import { permissionGranted } from './permission-grants.util';

/** Permissions boutique (équipe vendeur) — granulaires + bundles legacy. */
export const STORE_PERMISSIONS = [
  'dashboard.view',

  'catalog.view',
  'catalog.products.edit',
  'catalog.offers.edit',
  'catalog.drinks.edit',
  'catalog.daily_menu.edit',
  'catalog.stock.view',
  'catalog.stock.edit',
  /** @deprecated Bundle — accorde toutes les permissions catalogue (modification). */
  'catalog.edit',

  'orders.view',
  'orders.status.update',
  'orders.pickup.confirm',
  'orders.cancel',
  'orders.assign_delivery',
  /** @deprecated Bundle — gestion opérationnelle des commandes (hors remboursements). */
  'orders.manage',

  'customers.view',

  'finances.view',
  'finances.transactions.view',
  'finances.payouts.view',
  'finances.payouts.manage',
  'finances.reports.view',
  'finances.refunds.view',

  'marketing.view',
  'campaigns.view',
  'campaigns.manage',
  'coupons.view',
  'coupons.manage',
  'promotions.view',
  'promotions.manage',
  'subscribers.view',

  'team.view',
  'team.invite',
  'team.manage',

  'settings.view',
  'settings.profile.edit',
  'settings.delivery.edit',
  'settings.payments.view',
  'settings.payments.manage',
  'settings.notifications.edit',
  'settings.subscription.view',
  /** @deprecated Bundle — tous les paramètres boutique (sauf abonnement plateforme admin). */
  'settings.edit',

  'chat.view',

  'analytics.view',
] as const;

export type StorePermission = (typeof STORE_PERMISSIONS)[number];

export const STORE_PERMISSION_LABELS: Record<StorePermission, string> = {
  'dashboard.view': 'Tableau de bord',

  'catalog.view': 'Catalogue (lecture)',
  'catalog.products.edit': 'Produits (modification)',
  'catalog.offers.edit': 'Offres (modification)',
  'catalog.drinks.edit': 'Boissons (modification)',
  'catalog.daily_menu.edit': 'Menu du jour (modification)',
  'catalog.stock.view': 'Stock (lecture)',
  'catalog.stock.edit': 'Stock (modification)',
  'catalog.edit': 'Catalogue (modification — tout)',

  'orders.view': 'Commandes (lecture)',
  'orders.status.update': 'Commandes — statuts / préparation',
  'orders.pickup.confirm': 'Commandes — confirmation retrait',
  'orders.cancel': 'Commandes — annulation',
  'orders.assign_delivery': 'Commandes — auto-livraison vendeur',
  'orders.manage': 'Commandes (gestion — bundle)',

  'customers.view': 'Clients',

  'finances.view': 'Finances (vue d’ensemble)',
  'finances.transactions.view': 'Transactions',
  'finances.payouts.view': 'Versements Stripe (lecture)',
  'finances.payouts.manage': 'Versements Stripe (gestion)',
  'finances.reports.view': 'Rapports financiers',
  'finances.refunds.view': 'Remboursements (lecture)',

  'marketing.view': 'Marketing (vue d’ensemble)',
  'campaigns.view': 'Campagnes pub (lecture)',
  'campaigns.manage': 'Campagnes pub (gestion)',
  'coupons.view': 'Coupons (lecture)',
  'coupons.manage': 'Coupons (gestion)',
  'promotions.view': 'Promotions (lecture)',
  'promotions.manage': 'Promotions (gestion)',
  'subscribers.view': 'Abonnés boutique',

  'team.view': 'Équipe (lecture)',
  'team.invite': 'Équipe — invitations',
  'team.manage': 'Équipe (gestion complète)',

  'settings.view': 'Paramètres (lecture)',
  'settings.profile.edit': 'Fiche restaurant / profil',
  'settings.delivery.edit': 'Livraison boutique (zones, rayon)',
  'settings.payments.view': 'Paiements Stripe (lecture)',
  'settings.payments.manage': 'Paiements Stripe (onboarding)',
  'settings.notifications.edit': 'Notifications vendeur',
  'settings.subscription.view': 'Abonnement Wise Eat',
  'settings.edit': 'Paramètres boutique (bundle)',

  'chat.view': 'Messagerie / chat',

  'analytics.view': 'Analytics vendeur',
};

/** Bundles legacy → permissions fines (rétrocompatibilité rôles existants). */
export const STORE_PERMISSION_BUNDLE_GRANTS: Readonly<
  Record<string, readonly StorePermission[]>
> = {
  'catalog.edit': [
    'catalog.products.edit',
    'catalog.offers.edit',
    'catalog.drinks.edit',
    'catalog.daily_menu.edit',
    'catalog.stock.edit',
  ],
  'orders.manage': [
    'orders.status.update',
    'orders.pickup.confirm',
    'orders.cancel',
    'orders.assign_delivery',
  ],
  'finances.view': [
    'finances.transactions.view',
    'finances.payouts.view',
    'finances.reports.view',
    'finances.refunds.view',
  ],
  'marketing.view': [
    'campaigns.view',
    'coupons.view',
    'promotions.view',
    'subscribers.view',
  ],
  'coupons.manage': ['coupons.view'],
  'promotions.manage': ['promotions.view'],
  'campaigns.manage': ['campaigns.view'],
  'team.manage': ['team.view', 'team.invite'],
  'settings.edit': [
    'settings.profile.edit',
    'settings.delivery.edit',
    'settings.notifications.edit',
  ],
};

export const STORE_PERMISSION_GROUPS: Array<{
  id: string;
  label: string;
  keys: StorePermission[];
}> = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    keys: ['dashboard.view'],
  },
  {
    id: 'catalog',
    label: 'Catalogue',
    keys: [
      'catalog.view',
      'catalog.products.edit',
      'catalog.offers.edit',
      'catalog.drinks.edit',
      'catalog.daily_menu.edit',
      'catalog.stock.view',
      'catalog.stock.edit',
      'catalog.edit',
    ],
  },
  {
    id: 'orders',
    label: 'Commandes',
    keys: [
      'orders.view',
      'orders.status.update',
      'orders.pickup.confirm',
      'orders.cancel',
      'orders.assign_delivery',
      'orders.manage',
    ],
  },
  {
    id: 'customers',
    label: 'Clients',
    keys: ['customers.view'],
  },
  {
    id: 'finances',
    label: 'Finances',
    keys: [
      'finances.view',
      'finances.transactions.view',
      'finances.payouts.view',
      'finances.payouts.manage',
      'finances.reports.view',
      'finances.refunds.view',
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    keys: [
      'marketing.view',
      'campaigns.view',
      'campaigns.manage',
      'coupons.view',
      'coupons.manage',
      'promotions.view',
      'promotions.manage',
      'subscribers.view',
    ],
  },
  {
    id: 'team',
    label: 'Équipe',
    keys: ['team.view', 'team.invite', 'team.manage'],
  },
  {
    id: 'settings',
    label: 'Paramètres boutique',
    keys: [
      'settings.view',
      'settings.profile.edit',
      'settings.delivery.edit',
      'settings.payments.view',
      'settings.payments.manage',
      'settings.notifications.edit',
      'settings.subscription.view',
      'settings.edit',
    ],
  },
  {
    id: 'chat',
    label: 'Messagerie',
    keys: ['chat.view'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    keys: ['analytics.view'],
  },
];

export const ALL_STORE_PERMISSIONS: StorePermission[] = [...STORE_PERMISSIONS];

export const STORE_ROLE_TEMPLATE_ORDER = [
  'OWNER',
  'MANAGER',
  'SUPPORT',
  'MODERATOR',
  'ACCOUNTANT',
  'MARKETER',
  'CASHIER',
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
    description: 'Gestion quotidienne (sans équipe ni paiements Stripe)',
    permissions: ALL_STORE_PERMISSIONS.filter(
      (p) =>
        ![
          'team.manage',
          'team.invite',
          'settings.edit',
          'settings.payments.manage',
        ].includes(p),
    ),
  },
  {
    key: 'SUPPORT',
    name: 'Support',
    description: 'Commandes et messagerie — sans annulation ni finances',
    permissions: [
      'dashboard.view',
      'orders.view',
      'orders.status.update',
      'orders.pickup.confirm',
      'customers.view',
      'chat.view',
      'analytics.view',
    ],
  },
  {
    key: 'MODERATOR',
    name: 'Moderator',
    description: 'Catalogue et campagnes — sans commandes ni finances',
    permissions: [
      'dashboard.view',
      'catalog.view',
      'catalog.products.edit',
      'catalog.offers.edit',
      'catalog.drinks.edit',
      'catalog.daily_menu.edit',
      'marketing.view',
      'campaigns.manage',
    ],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Finances et commandes en lecture seule',
    permissions: [
      'dashboard.view',
      'orders.view',
      'customers.view',
      'finances.view',
      'finances.transactions.view',
      'finances.payouts.view',
      'finances.reports.view',
      'finances.refunds.view',
      'analytics.view',
    ],
  },
  {
    key: 'MARKETER',
    name: 'Marketer',
    description: 'Promotions, coupons et visibilité',
    permissions: [
      'dashboard.view',
      'marketing.view',
      'campaigns.manage',
      'coupons.manage',
      'promotions.manage',
      'catalog.view',
      'subscribers.view',
      'analytics.view',
    ],
  },
  {
    key: 'CASHIER',
    name: 'Cashier',
    description: 'Caisse / retrait — commandes et chat uniquement',
    permissions: [
      'dashboard.view',
      'orders.view',
      'orders.status.update',
      'orders.pickup.confirm',
      'chat.view',
    ],
  },
];

export function isStorePermission(value: string): value is StorePermission {
  return (STORE_PERMISSIONS as readonly string[]).includes(value);
}

export function storePermissionGranted(
  granted: readonly string[],
  required: StorePermission,
): boolean {
  return permissionGranted(
    granted,
    required,
    STORE_PERMISSION_BUNDLE_GRANTS,
  );
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
