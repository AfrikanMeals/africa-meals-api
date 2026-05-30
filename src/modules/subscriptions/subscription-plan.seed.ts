export type SubscriptionPlanSeed = {
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  features: string[];
  sortOrder: number;
  active: boolean;
  trialDays?: number;
  trialReminderDays?: number[];
  maxStores?: number;
  mobileAccess?: boolean;
};

export const DEFAULT_SUBSCRIPTION_PLAN_SEEDS: SubscriptionPlanSeed[] = [
  {
    name: 'FREE',
    description:
      'Pour démarrer et recevoir vos premières commandes sans engagement.',
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'CAD',
    features: [
      'Jusqu’à 10 produits actifs',
      'Réception des commandes',
      'Support standard par e-mail',
      'Statistiques de base',
      'Aucune gestion d’équipe (plan supérieur requis)',
    ],
    sortOrder: 1,
    active: true,
    trialDays: 0,
    trialReminderDays: [],
    maxStores: 1,
    mobileAccess: false,
  },
  {
    name: 'PRO',
    description:
      'Pour les restaurants en croissance qui veulent plus de performance.',
    priceMonthly: 59,
    priceYearly: 590,
    currency: 'CAD',
    features: [
      'Produits illimités',
      'Gestion d’équipe boutique',
      'Rapports avancés',
      'Priorité de support',
      'Promotions et offres avancées',
    ],
    sortOrder: 2,
    active: true,
    trialDays: 14,
    trialReminderDays: [7, 3, 1],
    maxStores: 0,
    mobileAccess: true,
  },
];
