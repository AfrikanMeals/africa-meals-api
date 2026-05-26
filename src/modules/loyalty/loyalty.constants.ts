/** Noms de niveaux alignés sur l’admin fidélité. */
export type LoyaltyTierName = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export const LOYALTY_INACTIVE_DAYS = 30;

/** Devise du programme fidélité (montants commande `totalPrice`). */
export const LOYALTY_CURRENCY = 'CAD';

/** 1 point par tranche de 100 CAD (montant commande `totalPrice`). */
export const LOYALTY_POINTS_PER_CAD_UNIT = 1;

/** Bonus crédité à l’activation manuelle du programme (admin). */
export const LOYALTY_WELCOME_BONUS_POINTS = 50;

export const LOYALTY_TIER_THRESHOLDS: ReadonlyArray<{
  name: LoyaltyTierName;
  min: number;
  max: number | null;
  icon: string;
  color: string;
  bg: string;
  advantages: string[];
}> = [
  {
    name: 'Bronze',
    min: 0,
    max: 500,
    icon: '🥉',
    color: '#cd7f32',
    bg: '#1a1208',
    advantages: [
      'Accumulation de points',
      'Offres spéciales occasionnelles',
    ],
  },
  {
    name: 'Silver',
    min: 500,
    max: 1500,
    icon: '🥈',
    color: '#c0c0c0',
    bg: '#141414',
    advantages: [
      'Livraison prioritaire',
      '5 % de réduction permanente',
      'Support dédié',
    ],
  },
  {
    name: 'Gold',
    min: 1500,
    max: 3000,
    icon: '🥇',
    color: '#f5a623',
    bg: '#1a1408',
    advantages: [
      '10 % de réduction permanente',
      'Livraison gratuite 2×/mois',
      'Accès offres exclusives',
      'Support VIP',
    ],
  },
  {
    name: 'Platinum',
    min: 3000,
    max: null,
    icon: '💎',
    color: '#a78bfa',
    bg: '#110f1a',
    advantages: [
      '20 % de réduction permanente',
      'Livraison gratuite illimitée',
      'Menu VIP exclusif',
      'Chef dédié sur demande',
      'Support 24/7',
    ],
  },
];

/** Catalogue affiché côté admin (échanges pas encore persistés en base). */
export const LOYALTY_REWARD_CATALOG = [
  {
    id: 'free_delivery',
    title: 'Livraison gratuite',
    icon: '🛵',
    points: 200,
    category: 'livraison',
    active: true,
  },
  {
    id: 'discount_10',
    title: 'Réduction 10 %',
    icon: '🏷️',
    points: 300,
    category: 'reduction',
    active: true,
  },
  {
    id: 'discount_25',
    title: 'Réduction 25 %',
    icon: '💸',
    points: 600,
    category: 'reduction',
    active: true,
  },
  {
    id: 'free_dish',
    title: "Plat offert (jusqu'à 50 $ CA)",
    icon: '🍽️',
    points: 1000,
    category: 'plat',
    active: true,
  },
  {
    id: 'vip_menu',
    title: 'Menu VIP exclusif',
    icon: '👑',
    points: 2000,
    category: 'vip',
    active: true,
  },
  {
    id: 'birthday',
    title: 'Cadeau anniversaire',
    icon: '🎂',
    points: 0,
    category: 'special',
    active: false,
  },
] as const;

export const LOYALTY_ORDER_CREDIT_REASON_PREFIX = 'order:';
