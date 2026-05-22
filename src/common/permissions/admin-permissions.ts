/** Permissions plateforme (équipe admin). */
export const ADMIN_PERMISSIONS = [
  'admin.dashboard',
  'admin.orders',
  'admin.catalog',
  'admin.clients',
  'admin.vendors',
  'admin.subscriptions',
  'admin.platform_fees',
  'admin.shipping',
  'admin.finances',
  'admin.marketing',
  'admin.chat',
  'admin.reports',
  'admin.team.view',
  'admin.team.manage',
  'admin.settings',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  'admin.dashboard': 'Tableau de bord',
  'admin.orders': 'Commandes',
  'admin.catalog': 'Catalogue',
  'admin.clients': 'Clients',
  'admin.vendors': 'Vendeurs',
  'admin.subscriptions': 'Abonnements',
  'admin.platform_fees': 'Frais plateforme',
  'admin.shipping': 'Livraison / zones',
  'admin.finances': 'Finances',
  'admin.marketing': 'Marketing',
  'admin.chat': 'Chat support',
  'admin.reports': 'Rapports',
  'admin.team.view': 'Équipe admin (lecture)',
  'admin.team.manage': 'Équipe admin (gestion)',
  'admin.settings': 'Paramètres plateforme',
};

export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  ...ADMIN_PERMISSIONS,
];

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
      'admin.orders',
      'admin.clients',
      'admin.chat',
    ],
  },
  {
    key: 'FINANCE',
    name: 'Finance',
    permissions: [
      'admin.dashboard',
      'admin.finances',
      'admin.reports',
      'admin.subscriptions',
    ],
  },
];

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}
