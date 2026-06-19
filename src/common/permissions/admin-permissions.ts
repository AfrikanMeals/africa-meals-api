import { permissionGranted } from './permission-grants.util';

/** Permissions plateforme (équipe admin). */
export const ADMIN_PERMISSIONS = [
  'admin.dashboard',

  'admin.orders.view',
  'admin.orders.manage',
  /** @deprecated Bundle commandes plateforme */
  'admin.orders',

  'admin.catalog',

  'admin.clients.view',
  'admin.clients.manage',
  /** @deprecated Bundle clients / fidélité */
  'admin.clients',

  'admin.vendors.view',
  'admin.vendors.manage',
  /** @deprecated Bundle vendeurs */
  'admin.vendors',

  'admin.subscriptions',

  'admin.platform_fees',
  'admin.checkout',

  'admin.shipping.tracking',
  'admin.shipping.drivers',
  'admin.shipping.platform',
  /** @deprecated Bundle livraison plateforme */
  'admin.shipping',

  'admin.finances.view',
  'admin.finances.manage',
  /** @deprecated Bundle finances plateforme */
  'admin.finances',

  'admin.marketing.view',
  'admin.marketing.manage',
  'admin.marketing.moderation',
  /** @deprecated Bundle marketing plateforme */
  'admin.marketing',

  'admin.chat',

  'admin.reports.view',
  'admin.reports.export',
  /** @deprecated Bundle rapports */
  'admin.reports',

  'admin.analytics',

  'admin.team.view',
  'admin.team.manage',

  'admin.settings.regions',
  'admin.settings.security',
  'admin.settings.cache',
  'admin.settings.platform',
  'admin.settings.ops',
  /** @deprecated Bundle paramètres plateforme */
  'admin.settings',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  'admin.dashboard': 'Tableau de bord',

  'admin.orders.view': 'Commandes (lecture)',
  'admin.orders.manage': 'Commandes (gestion / historique)',
  'admin.orders': 'Commandes (bundle)',

  'admin.catalog': 'Catalogue plateforme',

  'admin.clients.view': 'Clients (lecture)',
  'admin.clients.manage': 'Clients (gestion / fidélité)',
  'admin.clients': 'Clients (bundle)',

  'admin.vendors.view': 'Vendeurs (lecture)',
  'admin.vendors.manage': 'Vendeurs (gestion / équipes)',
  'admin.vendors': 'Vendeurs (bundle)',

  'admin.subscriptions': 'Abonnements vendeurs',

  'admin.platform_fees': 'Frais plateforme / billing',
  'admin.checkout': 'Checkout (preview pricing, cache)',

  'admin.shipping.tracking': 'Suivi livraisons',
  'admin.shipping.drivers': 'Livreurs / agents',
  'admin.shipping.platform': 'Barème livraison plateforme',
  'admin.shipping': 'Livraison (bundle)',

  'admin.finances.view': 'Finances (lecture)',
  'admin.finances.manage': 'Finances (pénalités, remboursements)',
  'admin.finances': 'Finances (bundle)',

  'admin.marketing.view': 'Marketing (lecture)',
  'admin.marketing.manage': 'Marketing (campagnes, ads)',
  'admin.marketing.moderation': 'Modération publicitaire',
  'admin.marketing': 'Marketing (bundle)',

  'admin.chat': 'Chat support',

  'admin.reports.view': 'Rapports (lecture)',
  'admin.reports.export': 'Rapports (export / stats)',
  'admin.reports': 'Rapports (bundle)',

  'admin.analytics': 'Analytics vendeurs',

  'admin.team.view': 'Équipe admin (lecture)',
  'admin.team.manage': 'Équipe admin (gestion)',

  'admin.settings.regions': 'Régions & taxes',
  'admin.settings.security': 'Sécurité & authentification',
  'admin.settings.cache': 'Cache & performance',
  'admin.settings.platform': 'Paramètres plateforme (storage, mobile, POS)',
  'admin.settings.ops': 'Ops (DB, intégrité, alertes, secrets)',
  'admin.settings': 'Paramètres plateforme (bundle)',
};

export const ADMIN_PERMISSION_BUNDLE_GRANTS: Readonly<
  Record<string, readonly AdminPermission[]>
> = {
  'admin.orders': ['admin.orders.view', 'admin.orders.manage'],
  'admin.clients': ['admin.clients.view', 'admin.clients.manage'],
  'admin.vendors': ['admin.vendors.view', 'admin.vendors.manage'],
  'admin.shipping': [
    'admin.shipping.tracking',
    'admin.shipping.drivers',
    'admin.shipping.platform',
  ],
  'admin.finances': ['admin.finances.view', 'admin.finances.manage'],
  'admin.marketing': [
    'admin.marketing.view',
    'admin.marketing.manage',
    'admin.marketing.moderation',
  ],
  'admin.reports': ['admin.reports.view', 'admin.reports.export'],
  'admin.settings': [
    'admin.settings.regions',
    'admin.settings.security',
    'admin.settings.cache',
    'admin.settings.platform',
    'admin.settings.ops',
  ],
  'admin.clients.manage': ['admin.clients.view'],
  'admin.vendors.manage': ['admin.vendors.view'],
  'admin.orders.manage': ['admin.orders.view'],
  'admin.finances.manage': ['admin.finances.view'],
  'admin.marketing.manage': ['admin.marketing.view'],
  'admin.reports.export': ['admin.reports.view'],
};

export const ADMIN_PERMISSION_GROUPS: Array<{
  id: string;
  label: string;
  keys: AdminPermission[];
}> = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    keys: ['admin.dashboard'],
  },
  {
    id: 'orders',
    label: 'Commandes',
    keys: ['admin.orders.view', 'admin.orders.manage', 'admin.orders'],
  },
  {
    id: 'catalog',
    label: 'Catalogue',
    keys: ['admin.catalog'],
  },
  {
    id: 'clients',
    label: 'Clients',
    keys: ['admin.clients.view', 'admin.clients.manage', 'admin.clients'],
  },
  {
    id: 'vendors',
    label: 'Vendeurs',
    keys: ['admin.vendors.view', 'admin.vendors.manage', 'admin.vendors'],
  },
  {
    id: 'billing',
    label: 'Billing & livraison',
    keys: [
      'admin.subscriptions',
      'admin.platform_fees',
      'admin.checkout',
      'admin.shipping.tracking',
      'admin.shipping.drivers',
      'admin.shipping.platform',
      'admin.shipping',
    ],
  },
  {
    id: 'finances',
    label: 'Finances',
    keys: ['admin.finances.view', 'admin.finances.manage', 'admin.finances'],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    keys: [
      'admin.marketing.view',
      'admin.marketing.manage',
      'admin.marketing.moderation',
      'admin.marketing',
    ],
  },
  {
    id: 'support',
    label: 'Support',
    keys: ['admin.chat'],
  },
  {
    id: 'reports',
    label: 'Rapports & analytics',
    keys: [
      'admin.reports.view',
      'admin.reports.export',
      'admin.reports',
      'admin.analytics',
    ],
  },
  {
    id: 'team',
    label: 'Équipe admin',
    keys: ['admin.team.view', 'admin.team.manage'],
  },
  {
    id: 'settings',
    label: 'Paramètres plateforme',
    keys: [
      'admin.settings.regions',
      'admin.settings.security',
      'admin.settings.cache',
      'admin.settings.platform',
      'admin.settings.ops',
      'admin.settings',
    ],
  },
];

export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [...ADMIN_PERMISSIONS];

export const DEFAULT_ADMIN_ROLE_TEMPLATES: Array<{
  key: string;
  name: string;
  permissions: AdminPermission[];
  isSuper?: boolean;
}> = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super administrateur',
    permissions: ALL_ADMIN_PERMISSIONS,
    isSuper: true,
  },
  {
    key: 'SUPPORT',
    name: 'Support',
    permissions: [
      'admin.dashboard',
      'admin.orders.view',
      'admin.clients.view',
      'admin.chat',
      'admin.vendors.view',
    ],
  },
  {
    key: 'FINANCE',
    name: 'Finance',
    permissions: [
      'admin.dashboard',
      'admin.finances.view',
      'admin.finances.manage',
      'admin.reports.view',
      'admin.analytics',
      'admin.subscriptions',
      'admin.platform_fees',
    ],
  },
  {
    key: 'OPERATIONS',
    name: 'Opérations',
    permissions: [
      'admin.dashboard',
      'admin.shipping.tracking',
      'admin.shipping.drivers',
      'admin.shipping.platform',
      'admin.checkout',
      'admin.settings.cache',
      'admin.settings.ops',
    ],
  },
  {
    key: 'MARKETING',
    name: 'Marketing',
    permissions: [
      'admin.dashboard',
      'admin.marketing.view',
      'admin.marketing.manage',
      'admin.marketing.moderation',
      'admin.analytics',
    ],
  },
];

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

export function adminPermissionGranted(
  granted: readonly string[],
  required: AdminPermission,
): boolean {
  return permissionGranted(
    granted,
    required,
    ADMIN_PERMISSION_BUNDLE_GRANTS,
  );
}
