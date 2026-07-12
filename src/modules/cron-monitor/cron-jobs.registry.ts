export type CronJobDefinition = {
  key: string;
  label: string;
  description: string;
  /** Expression cron par défaut si la variable schedule est absente. */
  defaultSchedule: string;
  /** Variable d'environnement pour l'expression (ex. ADMIN_OPS_REPORT_CRON). */
  scheduleEnvKey: string;
  /** Variable DISABLE_*_CRON=true pour couper au déploiement. */
  disableEnvKey: string;
};

export const CRON_JOBS_REGISTRY: CronJobDefinition[] = [
  {
    key: 'admin_ops_report',
    label: 'Rapport vendeur',
    description:
      'Envoi automatique du rapport d’activité (e-mail + Excel) aux propriétaires.',
    defaultSchedule: '15 * * * *',
    scheduleEnvKey: 'ADMIN_OPS_REPORT_CRON',
    disableEnvKey: 'DISABLE_ADMIN_OPS_REPORT_CRON',
  },
  {
    key: 'ad_notification_dispatch',
    label: 'Dispatch notifications Ads',
    description: 'File d’envoi des notifications publicitaires (e-mail, push, SMS).',
    defaultSchedule: '*/3 * * * *',
    scheduleEnvKey: 'AD_NOTIFICATION_DISPATCH_CRON',
    disableEnvKey: 'DISABLE_AD_NOTIFICATION_DISPATCH_CRON',
  },
  {
    key: 'subscription_lifecycle',
    label: 'Cycle de vie abonnements',
    description: 'Renouvellements, expirations et transitions d’abonnement.',
    defaultSchedule: '*/30 * * * *',
    scheduleEnvKey: 'SUBSCRIPTION_LIFECYCLE_CRON',
    disableEnvKey: 'DISABLE_SUBSCRIPTION_LIFECYCLE_CRON',
  },
  {
    key: 'subscription_trial_reminder',
    label: 'Rappel fin d’essai',
    description: 'Rappels avant la fin de la période d’essai abonnement.',
    defaultSchedule: '0 8 * * *',
    scheduleEnvKey: 'SUBSCRIPTION_TRIAL_REMINDER_CRON',
    disableEnvKey: 'DISABLE_SUBSCRIPTION_TRIAL_REMINDER_CRON',
  },
  {
    key: 'refund_processing',
    label: 'Traitement remboursements',
    description: 'Traitement automatique des remboursements en attente.',
    defaultSchedule: '*/15 * * * *',
    scheduleEnvKey: 'REFUND_PROCESSING_CRON',
    disableEnvKey: 'DISABLE_REFUND_PROCESSING_CRON',
  },
  {
    key: 'daily_menu_reminder',
    label: 'Rappel menu du jour',
    description: 'Rappel aux vendeurs de mettre à jour le menu du jour.',
    defaultSchedule: '0 9 * * *',
    scheduleEnvKey: 'DAILY_MENU_REMINDER_CRON',
    disableEnvKey: 'DISABLE_DAILY_MENU_REMINDER_CRON',
  },
  {
    key: 'account_deletion',
    label: 'Suppression de comptes',
    description: 'Finalisation des demandes de suppression de compte différées.',
    defaultSchedule: '0 * * * *',
    scheduleEnvKey: 'ACCOUNT_DELETION_CRON',
    disableEnvKey: 'DISABLE_ACCOUNT_DELETION_CRON',
  },
  {
    key: 'search_vector_reindex',
    label: 'Ré-indexation recherche',
    description:
      'Prépare l’index texte / vectoriel (plats, boutiques, boissons) pour la recherche sémantique.',
    defaultSchedule: '0 4 * * *',
    scheduleEnvKey: 'SEARCH_REINDEX_CRON',
    disableEnvKey: 'DISABLE_SEARCH_REINDEX_CRON',
  },
  {
    key: 'recommendation_training',
    label: 'Entraînement recommandations',
    description: 'Job d’entraînement / rafraîchissement du moteur de recommandations.',
    defaultSchedule: '15 3 * * *',
    scheduleEnvKey: 'RECOMMENDATION_TRAINING_CRON',
    disableEnvKey: 'DISABLE_RECOMMENDATION_TRAINING_CRON',
  },
  {
    key: 'shop_home_warm',
    label: 'Préchauffage Shop Home',
    description: 'Mise en cache / warm-up des données page d’accueil boutique.',
    defaultSchedule: '*/8 * * * *',
    scheduleEnvKey: 'SHOP_HOME_WARM_CRON',
    disableEnvKey: 'DISABLE_SHOP_HOME_WARM_CRON',
  },
  {
    key: 'product_discount_schedule',
    label: 'Promotions produits planifiées',
    description:
      'Applique ou retire automatiquement prix et promos selon les plages définies sur les plats.',
    defaultSchedule: '0/5 * * * *',
    scheduleEnvKey: 'PRODUCT_DISCOUNT_SCHEDULE_CRON',
    disableEnvKey: 'DISABLE_PRODUCT_DISCOUNT_SCHEDULE_CRON',
  },
  {
    key: 'ads_targeting_retention',
    label: 'Purge ciblage Ads',
    description: 'Purge des événements et logs de ciblage publicitaire obsolètes.',
    defaultSchedule: '0 2 * * *',
    scheduleEnvKey: 'ADS_TARGETING_RETENTION_CRON',
    disableEnvKey: 'DISABLE_ADS_TARGETING_RETENTION_CRON',
  },
  {
    key: 'pending_delivery_auto_close',
    label: 'Clôture livraisons client absent',
    description:
      'Clôture automatique des preuves sans confirmation client après le délai configuré.',
    defaultSchedule: '0 6 * * *',
    scheduleEnvKey: 'PENDING_DELIVERY_AUTO_CLOSE_CRON',
    disableEnvKey: 'DISABLE_PENDING_DELIVERY_AUTO_CLOSE_CRON',
  },
  {
    key: 'delivery_order_offer_expire',
    label: 'Expiration offres course flotte',
    description:
      'Expire les offres auto-dispatch livreur boutique et propose le candidat suivant.',
    defaultSchedule: '*/15 * * * * *',
    scheduleEnvKey: 'DELIVERY_ORDER_OFFER_CRON',
    disableEnvKey: 'DISABLE_DELIVERY_ORDER_OFFER_CRON',
  },
  {
    key: 'delivery_agent_payout_settle',
    label: 'Versements livreurs (badge)',
    description:
      'Relance les transfers Connect manqués et les versements DIAMOND quand le solde devient disponible.',
    defaultSchedule: '*/15 * * * *',
    scheduleEnvKey: 'DELIVERY_AGENT_PAYOUT_SETTLE_CRON',
    disableEnvKey: 'DISABLE_DELIVERY_AGENT_PAYOUT_SETTLE_CRON',
  },
];

const BY_KEY = new Map(CRON_JOBS_REGISTRY.map((j) => [j.key, j]));

export function getCronJobDefinition(key: string): CronJobDefinition | undefined {
  return BY_KEY.get(key.trim());
}

export function isKnownCronJobKey(key: string): boolean {
  return BY_KEY.has(key.trim());
}
