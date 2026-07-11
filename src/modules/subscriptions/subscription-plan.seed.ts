export type SubscriptionPlanSeed = {
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  features: string[];
  sortOrder: number;
  /** Score visibilité 0–100 (recommandations + Ads). */
  recommendationScore?: number;
  active: boolean;
  trialDays?: number;
  trialReminderDays?: number[];
  maxStores?: number;
  mobileAccess?: boolean;
  storeSubscriptionEnabled?: boolean;
  mealPreOrderEnabled?: boolean;
  pickupPayOnDeliveryEnabled?: boolean;
  marketingToolsEnabled?: boolean;
  mapEngineSwitcherEnabled?: boolean;
  mapEngineMapboxEnabled?: boolean;
  mapEngineGoogleEnabled?: boolean;
  mapEngineOsmEnabled?: boolean;
  vendorGeocodingEngine?: string;
  vendorGeocodingEnginePool?: { engine: string; weight: number }[];
  vendorRoutingEngine?: string;
  vendorRoutingEnginePool?: { engine: string; weight: number }[];
  selfDeliveryEnabled?: boolean;
  maxDeliveryAgents?: number;
  maxCatalogItems?: number;
  maxDailyMenuItems?: number;
  maxAdCampaignItems?: number;
  maxActiveBanners?: number;
  maxActiveCampaigns?: number;
  initialAdCashGift?: number;
  renewalAdCashGift?: number;
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
      'Jusqu’à 10 articles catalogue (plats + boissons)',
      'Réception des commandes',
      'Support standard par e-mail',
      'Statistiques de base',
      'Aucune gestion d’équipe (plan supérieur requis)',
    ],
    sortOrder: 1,
    recommendationScore: 10,
    active: true,
    trialDays: 0,
    trialReminderDays: [],
    maxStores: 1,
    mobileAccess: false,
    storeSubscriptionEnabled: false,
    marketingToolsEnabled: false,
    mapEngineSwitcherEnabled: false,
    mapEngineMapboxEnabled: false,
    mapEngineGoogleEnabled: false,
    mapEngineOsmEnabled: true,
    vendorGeocodingEngine: 'osm',
    vendorGeocodingEnginePool: [{ engine: 'osm', weight: 100 }],
    vendorRoutingEngine: 'osrm',
    vendorRoutingEnginePool: [{ engine: 'osrm', weight: 100 }],
    selfDeliveryEnabled: false,
    maxDeliveryAgents: 0,
    maxCatalogItems: 10,
    maxDailyMenuItems: 0,
    initialAdCashGift: 0,
    renewalAdCashGift: 0,
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
    recommendationScore: 75,
    active: true,
    trialDays: 14,
    trialReminderDays: [7, 3, 1],
    maxStores: 0,
    mobileAccess: true,
    storeSubscriptionEnabled: true,
    mealPreOrderEnabled: true,
    pickupPayOnDeliveryEnabled: true,
    marketingToolsEnabled: true,
    mapEngineSwitcherEnabled: true,
    mapEngineMapboxEnabled: true,
    mapEngineGoogleEnabled: true,
    mapEngineOsmEnabled: true,
    vendorGeocodingEngine: 'mapbox',
    vendorGeocodingEnginePool: [
      { engine: 'osm', weight: 10 },
      { engine: 'mapsco', weight: 20 },
      { engine: 'locationiq', weight: 20 },
      { engine: 'tomtom', weight: 20 },
      { engine: 'mapbox', weight: 25 },
      { engine: 'google', weight: 5 },
    ],
    vendorRoutingEngine: 'mapbox',
    vendorRoutingEnginePool: [
      { engine: 'osrm', weight: 20 },
      { engine: 'mapbox', weight: 60 },
      { engine: 'google_routes', weight: 20 },
    ],
    selfDeliveryEnabled: false,
    maxDeliveryAgents: 0,
    maxCatalogItems: 0,
    maxDailyMenuItems: 0,
    initialAdCashGift: 100,
    renewalAdCashGift: 50,
  },
];
