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
  | 'recommendations'
  | 'websockets'
  | 'orphan';

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
    key: 'stripe_penalties',
    collection: 'stripe_penalties',
    labelFr: 'Pénalités Stripe (transferts)',
    labelEn: 'Stripe penalties',
    category: 'billing',
  },
  {
    key: 'penalty_custom_motifs',
    collection: 'penalty_custom_motifs',
    labelFr: 'Motifs pénalités personnalisés',
    labelEn: 'Custom penalty reasons',
    category: 'billing',
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
  {
    key: 'platform_channel_settings',
    collection: 'platform_channel_settings',
    labelFr: 'Réglages channels (email, SMS, WhatsApp)',
    labelEn: 'Platform channel settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'auth_settings',
    collection: 'auth_settings',
    labelFr: 'Réglages authentification',
    labelEn: 'Auth settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'security_settings',
    collection: 'security_settings',
    labelFr: 'Réglages sécurité',
    labelEn: 'Security settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'mobile_app_settings',
    collection: 'mobile_app_settings',
    labelFr: 'Réglages app mobile',
    labelEn: 'Mobile app settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'map_settings',
    collection: 'map_settings',
    labelFr: 'Réglages cartographie',
    labelEn: 'Map settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'storage_settings',
    collection: 'storage_settings',
    labelFr: 'Réglages stockage médias',
    labelEn: 'Storage settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'cache_settings',
    collection: 'cache_settings',
    labelFr: 'Réglages cache',
    labelEn: 'Cache settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'search_settings',
    collection: 'search_settings',
    labelFr: 'Réglages recherche',
    labelEn: 'Search settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'search_index_entries',
    collection: 'search_index_entries',
    labelFr: 'Index recherche',
    labelEn: 'Search index entries',
    category: 'platform',
  },
  {
    key: 'loyalty_settings',
    collection: 'loyalty_settings',
    labelFr: 'Réglages fidélité',
    labelEn: 'Loyalty settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'platform_business_types',
    collection: 'platform_business_types',
    labelFr: 'Types de commerce plateforme',
    labelEn: 'Platform business types',
    category: 'platform',
    critical: true,
  },
  {
    key: 'maintenance_alert_settings',
    collection: 'maintenance_alert_settings',
    labelFr: 'Alertes maintenance infra',
    labelEn: 'Maintenance alert settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'infra_runtime_settings',
    collection: 'infra_runtime_settings',
    labelFr: 'Réglages runtime infra',
    labelEn: 'Infra runtime settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'infra_cron_job_states',
    collection: 'infra_cron_job_states',
    labelFr: 'États jobs cron',
    labelEn: 'Cron job states',
    category: 'platform',
  },
  {
    key: 'secret_manager_settings',
    collection: 'secret_manager_settings',
    labelFr: 'Secret Manager (références)',
    labelEn: 'Secret manager settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'admin_ops_report_settings',
    collection: 'admin_ops_report_settings',
    labelFr: 'Réglages rapports ops admin',
    labelEn: 'Admin ops report settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'pos_settings',
    collection: 'pos_settings',
    labelFr: 'Réglages POS',
    labelEn: 'POS settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'pos_license_plans',
    collection: 'pos_license_plans',
    labelFr: 'Plans licence POS',
    labelEn: 'POS license plans',
    category: 'platform',
    critical: true,
  },
  {
    key: 'pos_vendor_licenses',
    collection: 'pos_vendor_licenses',
    labelFr: 'Licences POS vendeurs',
    labelEn: 'POS vendor licenses',
    category: 'billing',
  },
  {
    key: 'ad_pricing_settings',
    collection: 'ad_pricing_settings',
    labelFr: 'Barème publicité (global)',
    labelEn: 'Ad pricing settings',
    category: 'marketing',
    critical: true,
  },
  {
    key: 'ad_notification_pricing_settings',
    collection: 'ad_notification_pricing_settings',
    labelFr: 'Barème notifications publicitaires',
    labelEn: 'Ad notification pricing settings',
    category: 'marketing',
    critical: true,
  },
  {
    key: 'ad_notification_events',
    collection: 'ad_notification_events',
    labelFr: 'Événements notifications pub',
    labelEn: 'Ad notification events',
    category: 'marketing',
  },
  {
    key: 'ad_campaigns',
    collection: 'ad_campaigns',
    labelFr: 'Campagnes publicitaires',
    labelEn: 'Ad campaigns',
    category: 'marketing',
  },
  {
    key: 'ad_campaign_events',
    collection: 'ad_campaign_events',
    labelFr: 'Événements campagnes pub',
    labelEn: 'Ad campaign events',
    category: 'marketing',
  },
  {
    key: 'ad_credit_payments',
    collection: 'ad-credit-payments',
    labelFr: 'Paiements crédit pub',
    labelEn: 'Ad credit payments',
    category: 'billing',
  },
  {
    key: 'ads_targeting_profiles',
    collection: 'ads_targeting_profiles',
    labelFr: 'Profils ciblage publicité',
    labelEn: 'Ads targeting profiles',
    category: 'marketing',
  },
  {
    key: 'ads_targeting_events',
    collection: 'ads_targeting_events',
    labelFr: 'Événements ciblage pub',
    labelEn: 'Ads targeting events',
    category: 'marketing',
  },
  {
    key: 'ads_targeting_audit_logs',
    collection: 'ads_targeting_audit_logs',
    labelFr: 'Audit ciblage publicité',
    labelEn: 'Ads targeting audit logs',
    category: 'marketing',
  },
  {
    key: 'vendor_notification_preferences',
    collection: 'vendor_notification_preferences',
    labelFr: 'Préférences notifications vendeur',
    labelEn: 'Vendor notification preferences',
    category: 'marketing',
  },
  {
    key: 'vendor_notification_deliveries',
    collection: 'vendor_notification_deliveries',
    labelFr: 'Envois notifications vendeur',
    labelEn: 'Vendor notification deliveries',
    category: 'marketing',
  },
  {
    key: 'vendor_notification_monthly_charges',
    collection: 'vendor_notification_monthly_charges',
    labelFr: 'Facturation mensuelle notif vendeur',
    labelEn: 'Vendor notification monthly charges',
    category: 'billing',
  },
  {
    key: 'vendor_notification_pricing_settings',
    collection: 'vendor_notification_pricing_settings',
    labelFr: 'Barème notifications vendeur',
    labelEn: 'Vendor notification pricing settings',
    category: 'marketing',
    critical: true,
  },
  {
    key: 'vendor_analytics_events',
    collection: 'vendor_analytics_events',
    labelFr: 'Événements analytics vendeur',
    labelEn: 'Vendor analytics events',
    category: 'marketing',
  },
  {
    key: 'newsletter_subscribers',
    collection: 'newsletter_subscribers',
    labelFr: 'Abonnés newsletter',
    labelEn: 'Newsletter subscribers',
    category: 'marketing',
  },
  {
    key: 'store_subscribers',
    collection: 'store_subscribers',
    labelFr: 'Abonnés boutiques',
    labelEn: 'Store subscribers',
    category: 'stores',
  },
  {
    key: 'store_delivery_driver_memberships',
    collection: 'store_delivery_driver_memberships',
    labelFr: 'Affectations livreurs boutique',
    labelEn: 'Store delivery driver memberships',
    category: 'delivery',
  },
  {
    key: 'vendor_guide_articles',
    collection: 'vendor_guide_articles',
    labelFr: 'Articles guide vendeur',
    labelEn: 'Vendor guide articles',
    category: 'platform',
  },
  {
    key: 'vendor_guide_settings',
    collection: 'vendor_guide_settings',
    labelFr: 'Réglages guide vendeur',
    labelEn: 'Vendor guide settings',
    category: 'platform',
    critical: true,
  },
  {
    key: 'vendor_guide_progress',
    collection: 'vendor_guide_progress',
    labelFr: 'Progression guide vendeur',
    labelEn: 'Vendor guide progress',
    category: 'users',
  },
  {
    key: 'vendor_feature_requests',
    collection: 'vendor_feature_requests',
    labelFr: 'Demandes fonctionnalités vendeur',
    labelEn: 'Vendor feature requests',
    category: 'support',
  },
  {
    key: 'vendor_feedbacks',
    collection: 'vendor_feedbacks',
    labelFr: 'Retours vendeurs',
    labelEn: 'Vendor feedbacks',
    category: 'support',
  },
  {
    key: 'vendor_ops_report_deliveries',
    collection: 'vendor_ops_report_deliveries',
    labelFr: 'Envois rapports ops vendeur',
    labelEn: 'Vendor ops report deliveries',
    category: 'marketing',
  },
  {
    key: 'partner_badges',
    collection: 'partner_badges',
    labelFr: 'Badges partenaires',
    labelEn: 'Partner badges',
    category: 'platform',
    critical: true,
  },
  {
    key: 'site_contact_requests',
    collection: 'site_contact_requests',
    labelFr: 'Demandes contact site',
    labelEn: 'Site contact requests',
    category: 'support',
  },
  {
    key: 'dashboard_audit_logs',
    collection: 'dashboard_audit_logs',
    labelFr: 'Journal audit dashboard',
    labelEn: 'Dashboard audit logs',
    category: 'platform',
  },
  {
    key: 'documentation_groups',
    collection: 'documentation_groups',
    labelFr: 'Groupes documentation',
    labelEn: 'Documentation groups',
    category: 'platform',
  },
  {
    key: 'documentation_topics',
    collection: 'documentation_topics',
    labelFr: 'Sujets documentation',
    labelEn: 'Documentation topics',
    category: 'platform',
  },
  {
    key: 'documentation_subjects',
    collection: 'documentation_subjects',
    labelFr: 'Articles documentation',
    labelEn: 'Documentation subjects',
    category: 'platform',
  },
  {
    key: 'blog_groups',
    collection: 'blog_groups',
    labelFr: 'Groupes blog',
    labelEn: 'Blog groups',
    category: 'marketing',
  },
  {
    key: 'blog_articles',
    collection: 'blog_articles',
    labelFr: 'Articles blog',
    labelEn: 'Blog articles',
    category: 'marketing',
  },
  {
    key: 'chat_conversations',
    collection: 'chat_conversations',
    labelFr: 'Conversations chat (WebSocket)',
    labelEn: 'Chat conversations (WebSocket)',
    category: 'websockets',
  },
  {
    key: 'chat_messages',
    collection: 'chat_messages',
    labelFr: 'Messages chat (WebSocket)',
    labelEn: 'Chat messages (WebSocket)',
    category: 'websockets',
  },
] as const;

const KEY_SET = new Set(DB_CLEARABLE_TABLES.map((t) => t.key));
const KNOWN_COLLECTIONS = new Set(DB_CLEARABLE_TABLES.map((t) => t.collection));

/** Préfixe stable pour collections MongoDB absentes du catalogue admin. */
export const ORPHAN_TABLE_KEY_PREFIX = 'orphan:';

const ORPHAN_COLLECTION_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/;
const SYSTEM_COLLECTION_PREFIX = 'system.';

export function getKnownClearableCollections(): ReadonlySet<string> {
  return KNOWN_COLLECTIONS;
}

export function buildOrphanTableKey(collection: string): string {
  return `${ORPHAN_TABLE_KEY_PREFIX}${collection}`;
}

export function isOrphanTableKey(key: string): boolean {
  return key.startsWith(ORPHAN_TABLE_KEY_PREFIX);
}

export function parseOrphanTableKey(key: string): string {
  return key.slice(ORPHAN_TABLE_KEY_PREFIX.length);
}

/** Nom de collection MongoDB autorisé pour une orpheline (hors system.*). */
export function isValidOrphanCollectionName(name: string): boolean {
  const n = String(name ?? '').trim();
  if (!n || n.startsWith(SYSTEM_COLLECTION_PREFIX)) return false;
  return ORPHAN_COLLECTION_NAME.test(n);
}

export function isClearableTableKey(key: string): boolean {
  if (KEY_SET.has(key)) return true;
  if (!isOrphanTableKey(key)) return false;
  return isValidOrphanCollectionName(parseOrphanTableKey(key));
}

export function getClearableTable(
  key: string,
): DbClearableTableDef | undefined {
  return DB_CLEARABLE_TABLES.find((t) => t.key === key);
}

/** Résout une clé catalogue ou orpheline (`orphan:<collection>`). */
export function resolveClearableTable(
  key: string,
): DbClearableTableDef | undefined {
  const known = getClearableTable(key);
  if (known) return known;
  if (!isOrphanTableKey(key)) return undefined;
  const collection = parseOrphanTableKey(key);
  if (!isValidOrphanCollectionName(collection)) return undefined;
  if (KNOWN_COLLECTIONS.has(collection)) return undefined;
  return {
    key,
    collection,
    labelFr: `Orpheline — ${collection}`,
    labelEn: `Orphan — ${collection}`,
    category: 'orphan',
  };
}

export const DB_CLEAR_CONFIRM_PHRASE = 'VIDER_AFRIKAMEALS';
