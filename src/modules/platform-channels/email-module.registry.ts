/** Modules applicatifs pouvant envoyer des e-mails transactionnels. */
export const EMAIL_APP_MODULES = [
  {
    id: 'auth',
    label: 'Authentification',
    hint: 'Vérification e-mail, réinitialisation mot de passe, codes 2FA.',
  },
  {
    id: 'orders',
    label: 'Commandes',
    hint: 'Factures payées et confirmations de commande.',
  },
  {
    id: 'ads',
    label: 'Notifications Ads',
    hint: 'Add-on notifications publicitaires (campagnes et bannières).',
  },
  {
    id: 'vendor_notifications',
    label: 'Notifications vendeur',
    hint: 'Alertes commandes et messages billing vendeur.',
  },
  {
    id: 'vendor_status',
    label: 'Statut vendeur',
    hint: 'Approbation boutique, onboarding partenaire.',
  },
  {
    id: 'maintenance',
    label: 'Maintenance & alertes',
    hint: 'Alertes ops et bascule maintenance plateforme.',
  },
  {
    id: 'business_reports',
    label: 'Signalements',
    hint: 'E-mails liés aux signalements (business reports).',
  },
  {
    id: 'admin_ops',
    label: 'Rapports admin',
    hint: 'Rapports ops et campagnes alertes administrateur.',
  },
  {
    id: 'delivery',
    label: 'Livraison',
    hint: 'Candidatures livreur et drivers boutique.',
  },
  {
    id: 'store',
    label: 'Boutique',
    hint: 'Invitations équipe et e-mails boutique.',
  },
  {
    id: 'refunds',
    label: 'Remboursements',
    hint: 'Notifications remboursement client / vendeur.',
  },
  {
    id: 'penalties',
    label: 'Pénalités',
    hint: 'E-mails participants aux pénalités.',
  },
  {
    id: 'subscriptions',
    label: 'Abonnements',
    hint: 'E-mails abonnement vendeur.',
  },
  {
    id: 'newsletter',
    label: 'Newsletter & contact',
    hint: 'Newsletter blog et réponses formulaire contact.',
  },
  {
    id: 'login_notify',
    label: 'Connexion',
    hint: 'Notification de nouvelle connexion.',
  },
] as const;

export type EmailAppModuleId = (typeof EMAIL_APP_MODULES)[number]['id'];

const MODULE_ID_SET = new Set<string>(EMAIL_APP_MODULES.map((m) => m.id));

export function isKnownEmailAppModuleId(value: string): value is EmailAppModuleId {
  return MODULE_ID_SET.has(value);
}

export function getEmailAppModule(id: string) {
  return EMAIL_APP_MODULES.find((m) => m.id === id) ?? null;
}

/** Déduit le module e-mail depuis logContext (sendSimple). */
export function inferEmailModuleFromLogContext(
  logContext?: string,
): EmailAppModuleId | undefined {
  const ctx = String(logContext ?? '').trim().toLowerCase();
  if (!ctx) return undefined;
  if (ctx.startsWith('order-paid-invoice')) return 'orders';
  if (ctx.startsWith('maintenance-alert') || ctx.startsWith('platform-maintenance')) {
    return 'maintenance';
  }
  if (ctx.startsWith('login-notification')) return 'login_notify';
  if (ctx.startsWith('site-contact')) return 'newsletter';
  if (ctx.startsWith('blog-newsletter') || ctx.startsWith('food-newsletter')) {
    return 'newsletter';
  }
  if (ctx.startsWith('admin-alert') || ctx.includes('admin-ops')) return 'admin_ops';
  if (ctx.startsWith('business-report')) return 'business_reports';
  if (ctx.includes('vendor-subscription')) return 'subscriptions';
  if (ctx.includes('vendor-ops') || ctx.includes('vendor-notification')) {
    return 'vendor_notifications';
  }
  if (ctx.includes('vendor-status') || ctx.includes('partner-onboarding')) {
    return 'vendor_status';
  }
  if (ctx.includes('delivery-agent') || ctx.includes('delivery-driver')) return 'delivery';
  if (ctx.includes('refund')) return 'refunds';
  if (ctx.includes('penalty')) return 'penalties';
  if (ctx.includes('store-team') || ctx.includes('store-invite')) return 'store';
  return undefined;
}
