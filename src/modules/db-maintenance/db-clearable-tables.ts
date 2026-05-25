export type DbClearableTableCategory =
  | 'orders'
  | 'catalog'
  | 'stores'
  | 'users'
  | 'delivery'
  | 'marketing'
  | 'billing'
  | 'platform'
  | 'support'
  | 'recommendations';

export type DbClearableTableDef = {
  /** Identifiant envoyé par le client (stable). */
  key: string;
  /** Nom de collection MongoDB. */
  collection: string;
  labelFr: string;
  labelEn: string;
  category: DbClearableTableCategory;
  /** Tables sensibles (comptes, rôles, réglages globaux). */
  critical?: boolean;
};

export const DB_CLEARABLE_TABLES: readonly DbClearableTableDef[] = [
  {
    key: 'orders',
    collection: 'orders',
    labelFr: 'Commandes',
    labelEn: 'Orders',
    category: 'orders',
  },
  {
    key: 'order_status_events',
    collection: 'order_status_events',
    labelFr: 'Historique statuts commandes',
    labelEn: 'Order status history',
    category: 'orders',
  },
  {
    key: 'cart_items',
    collection: 'cart_items',
    labelFr: 'Lignes panier',
    labelEn: 'Cart items',
    category: 'orders',
  },
  {
    key: 'stripe_processed_checkouts',
    collection: 'stripe_processed_checkouts',
    labelFr: 'Paiements Stripe traités',
    labelEn: 'Stripe processed checkouts',
    category: 'billing',
  },
  {
    key: 'products',
    collection: 'products',
    labelFr: 'Produits',
    labelEn: 'Products',
    category: 'catalog',
  },
  {
    key: 'product_extras',
    collection: 'product_extras',
    labelFr: 'Extras produits',
    labelEn: 'Product extras',
    category: 'catalog',
  },
  {
    key: 'drinks',
    collection: 'drinks',
    labelFr: 'Boissons',
    labelEn: 'Drinks',
    category: 'catalog',
  },
  {
    key: 'product_categories',
    collection: 'product_categories',
    labelFr: 'Catégories produits',
    labelEn: 'Product categories',
    category: 'catalog',
  },
  {
    key: 'offers',
    collection: 'offers',
    labelFr: 'Offres',
    labelEn: 'Offers',
    category: 'catalog',
  },
  {
    key: 'offer_items',
    collection: 'offer_items',
    labelFr: 'Articles offres',
    labelEn: 'Offer items',
    category: 'catalog',
  },
  {
    key: 'stocks',
    collection: 'stocks',
    labelFr: 'Stocks',
    labelEn: 'Stock items',
    category: 'catalog',
  },
  {
    key: 'product_ratings',
    collection: 'product_ratings',
    labelFr: 'Avis produits',
    labelEn: 'Product ratings',
    category: 'catalog',
  },
  {
    key: 'store_ratings',
    collection: 'store_ratings',
    labelFr: 'Avis boutiques',
    labelEn: 'Store ratings',
    category: 'catalog',
  },
  {
    key: 'store_coupons',
    collection: 'store_coupons',
    labelFr: 'Coupons boutique',
    labelEn: 'Store coupons',
    category: 'catalog',
  },
  {
    key: 'stores',
    collection: 'stores',
    labelFr: 'Boutiques',
    labelEn: 'Stores',
    category: 'stores',
    critical: true,
  },
  {
    key: 'store_members',
    collection: 'store_members',
    labelFr: 'Membres boutique',
    labelEn: 'Store members',
    category: 'stores',
  },
  {
    key: 'store_roles',
    collection: 'store_roles',
    labelFr: 'Rôles boutique',
    labelEn: 'Store roles',
    category: 'stores',
    critical: true,
  },
  {
    key: 'addresses',
    collection: 'addresses',
    labelFr: 'Adresses',
    labelEn: 'Addresses',
    category: 'users',
  },
  {
    key: 'users',
    collection: 'users',
    labelFr: 'Utilisateurs',
    labelEn: 'Users',
    category: 'users',
    critical: true,
  },
  {
    key: 'pending_signups',
    collection: 'pending_signups',
    labelFr: 'Inscriptions en attente',
    labelEn: 'Pending signups',
    category: 'users',
  },
  {
    key: 'payment_methods',
    collection: 'payment_methods',
    labelFr: 'Moyens de paiement',
    labelEn: 'Payment methods',
    category: 'billing',
  },
  {
    key: 'vendor_subscriptions',
    collection: 'vendor_subscriptions',
    labelFr: 'Abonnements vendeurs',
    labelEn: 'Vendor subscriptions',
    category: 'billing',
  },
  {
    key: 'subscription_plans',
    collection: 'subscription_plans',
    labelFr: 'Plans abonnement',
    labelEn: 'Subscription plans',
    category: 'billing',
    critical: true,
  },
  {
    key: 'delivery_agent_applications',
    collection: 'delivery_agent_applications',
    labelFr: 'Candidatures livreurs',
    labelEn: 'Delivery agent applications',
    category: 'delivery',
  },
  {
    key: 'delivery_drivers',
    collection: 'delivery_drivers',
    labelFr: 'Fiches livreurs',
    labelEn: 'Delivery drivers',
    category: 'delivery',
  },
  {
    key: 'ads',
    collection: 'ads',
    labelFr: 'Publicités',
    labelEn: 'Ads',
    category: 'marketing',
  },
  {
    key: 'ad_events',
    collection: 'ad_events',
    labelFr: 'Événements publicité',
    labelEn: 'Ad events',
    category: 'marketing',
  },
  {
    key: 'announcements',
    collection: 'announcements',
    labelFr: 'Annonces',
    labelEn: 'Announcements',
    category: 'marketing',
  },
  {
    key: 'app_notifications',
    collection: 'app_notifications',
    labelFr: 'Notifications app',
    labelEn: 'App notifications',
    category: 'marketing',
  },
  {
    key: 'notification_read_receipts',
    collection: 'notification_read_receipts',
    labelFr: 'Accusés lecture notifications',
    labelEn: 'Notification read receipts',
    category: 'marketing',
  },
  {
    key: 'business_store_reports',
    collection: 'business_store_reports',
    labelFr: 'Signalements boutiques',
    labelEn: 'Store reports',
    category: 'support',
  },
  {
    key: 'support_chat_messages',
    collection: 'support_chat_messages',
    labelFr: 'Messages chat support',
    labelEn: 'Support chat messages',
    category: 'support',
  },
  {
    key: 'user_recommendation_signals',
    collection: 'user_recommendation_signals',
    labelFr: 'Signaux recommandation',
    labelEn: 'Recommendation signals',
    category: 'recommendations',
  },
  {
    key: 'user_recommendation_digests',
    collection: 'user_recommendation_digests',
    labelFr: 'Digests recommandation',
    labelEn: 'Recommendation digests',
    category: 'recommendations',
  },
  {
    key: 'recommendation_training_snapshots',
    collection: 'recommendation_training_snapshots',
    labelFr: 'Snapshots entraînement reco',
    labelEn: 'Recommendation training snapshots',
    category: 'recommendations',
  },
  {
    key: 'platform_fees_settings',
    collection: 'platform_fees_settings',
    labelFr: 'Réglages frais plateforme',
    labelEn: 'Platform fees settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'platform_shipping_settings',
    collection: 'platform_shipping_settings',
    labelFr: 'Réglages livraison plateforme',
    labelEn: 'Platform shipping settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'refund_processing_settings',
    collection: 'refund_processing_settings',
    labelFr: 'Réglages remboursements',
    labelEn: 'Refund processing settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'app_policies',
    collection: 'app_policies',
    labelFr: 'Politiques (CGU, etc.)',
    labelEn: 'App policies',
    category: 'platform',
    critical: true,
  },
  {
    key: 'platform_roles',
    collection: 'platform_roles',
    labelFr: 'Rôles administrateurs',
    labelEn: 'Platform admin roles',
    category: 'platform',
    critical: true,
  },
  {
    key: 'supported_countries',
    collection: 'supported_countries',
    labelFr: 'Pays supportés',
    labelEn: 'Supported countries',
    category: 'platform',
    critical: true,
  },
] as const;

const KEY_SET = new Set(DB_CLEARABLE_TABLES.map((t) => t.key));

export function isClearableTableKey(key: string): boolean {
  return KEY_SET.has(key);
}

export function getClearableTable(key: string): DbClearableTableDef | undefined {
  return DB_CLEARABLE_TABLES.find((t) => t.key === key);
}

export const DB_CLEAR_CONFIRM_PHRASE = 'VIDER_AFRIKAMEALS';
