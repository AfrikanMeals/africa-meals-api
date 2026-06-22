/** Clés de modules activables séparément sur le portail admin et l’app mobile. */
export const PLATFORM_FEATURE_MODULE_KEYS = [
  'deliveryTools',
  'pickup',
  'marketing',
  'vendorTools',
  'deliveryAgent',
  'chat',
] as const;

export type PlatformFeatureModuleKey =
  (typeof PLATFORM_FEATURE_MODULE_KEYS)[number];

export type PlatformSurfaceModules = Record<PlatformFeatureModuleKey, boolean>;

export const DEFAULT_PLATFORM_SURFACE_MODULES: PlatformSurfaceModules = {
  deliveryTools: true,
  pickup: true,
  marketing: true,
  vendorTools: true,
  deliveryAgent: true,
  chat: true,
};

export const PLATFORM_FEATURE_MODULE_DEFINITIONS: ReadonlyArray<{
  key: PlatformFeatureModuleKey;
  labelFr: string;
  labelEn: string;
  descriptionFr: string;
}> = [
  {
    key: 'deliveryTools',
    labelFr: 'Outils livraison',
    labelEn: 'Delivery tools',
    descriptionFr:
      'Livraison à domicile, suivi, livreurs, zones et frais (hors retrait en magasin).',
  },
  {
    key: 'pickup',
    labelFr: 'Retrait en magasin',
    labelEn: 'Pickup',
    descriptionFr:
      'Commandes à retirer sur place (pickup) côté client et vendeur.',
  },
  {
    key: 'marketing',
    labelFr: 'Outils marketing',
    labelEn: 'Marketing tools',
    descriptionFr:
      'Publicités, coupons, promotions, campagnes et bannières.',
  },
  {
    key: 'vendorTools',
    labelFr: 'Outils vendeur',
    labelEn: 'Vendor tools',
    descriptionFr:
      'Mode boutique, catalogue vendeur, équipes et gestion partenaire.',
  },
  {
    key: 'deliveryAgent',
    labelFr: 'Mode livreur',
    labelEn: 'Delivery agent',
    descriptionFr:
      'Application livreur, candidatures et suivi côté agent.',
  },
  {
    key: 'chat',
    labelFr: 'Messagerie',
    labelEn: 'Chat',
    descriptionFr: 'Chat client–boutique et support.',
  },
];
