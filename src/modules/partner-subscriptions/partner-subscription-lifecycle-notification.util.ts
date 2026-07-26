/** Événements notifiés (inbox + FCM + e-mail) pour l’abonnement Partner. */
export type PartnerSubscriptionLifecycleKind =
  | 'CHANGED'
  | 'EXPIRED'
  | 'TRIAL_REMINDER';

export type PartnerSubscriptionLifecycleNotificationCopy = {
  title: string;
  body: string;
  /** Type canonique `app_notifications.type` / FCM data.type. */
  type: string;
};

export const PARTNER_SUBSCRIPTION_CHANGED_TYPE =
  'partner_subscription_changed';
export const PARTNER_SUBSCRIPTION_EXPIRED_TYPE =
  'partner_subscription_expired';
export const PARTNER_SUBSCRIPTION_TRIAL_REMINDER_TYPE =
  'partner_subscription_trial_reminder';

/**
 * Copie inbox / push pour un événement d’abonnement Partner.
 * Pure — testable sans Nest / FCM / SMTP.
 */
export function buildPartnerSubscriptionLifecycleNotificationCopy(args: {
  kind: PartnerSubscriptionLifecycleKind;
  planName?: string | null;
  daysRemaining?: number | null;
}): PartnerSubscriptionLifecycleNotificationCopy {
  const plan = String(args.planName ?? '').trim() || 'votre formule Partner';
  const days = Math.max(1, Math.floor(Number(args.daysRemaining) || 1));

  switch (args.kind) {
    case 'CHANGED':
      return {
        type: PARTNER_SUBSCRIPTION_CHANGED_TYPE,
        title: 'Abonnement Partner mis à jour',
        body: `Votre formule Partner est maintenant « ${plan} ». Consultez les détails dans Abonnement.`,
      };
    case 'EXPIRED':
      return {
        type: PARTNER_SUBSCRIPTION_EXPIRED_TYPE,
        title: 'Abonnement Partner expiré',
        body: `Votre formule « ${plan} » a expiré. Souscrivez à nouveau pour conserver l’affiliation.`,
      };
    case 'TRIAL_REMINDER':
      return {
        type: PARTNER_SUBSCRIPTION_TRIAL_REMINDER_TYPE,
        title:
          days <= 1
            ? 'Essai Partner : dernier jour'
            : 'Rappel essai abonnement Partner',
        body:
          days <= 1
            ? `Votre essai ${plan} se termine demain. Souscrivez pour garder l’affiliation.`
            : `Il reste ${days} jour(s) à votre essai ${plan}. Souscrivez avant la fin.`,
      };
    default:
      return {
        type: PARTNER_SUBSCRIPTION_CHANGED_TYPE,
        title: 'Abonnement Partner',
        body: 'Votre abonnement Partner a été mis à jour.',
      };
  }
}
