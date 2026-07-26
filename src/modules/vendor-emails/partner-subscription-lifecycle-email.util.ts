/**
 * Copie e-mails cycle de vie abonnement Partner — pure pour tests.
 * Les valeurs nom / plan sont déjà échappées HTML côté service.
 */

export type PartnerSubscriptionLifecycleEmailCopy = {
  subject: string;
  greetingLine: string;
  bodyParagraphs: string[];
  helpParagraphs: string[];
};

export function buildPartnerSubscriptionChangedEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  safePlanName: string;
  supportEmail: string;
}): PartnerSubscriptionLifecycleEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const plan = args.safePlanName.trim() || 'votre formule';
  const support = args.supportEmail.trim() || 'support@wise-eat.com';
  return {
    subject: `${app} — Abonnement Partner mis à jour`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      `Votre <strong>abonnement Partner</strong> sur <strong>${app}</strong> a été mis à jour.`,
      `Formule active : <strong>${plan}</strong>.`,
      `Ouvrez l’application (mode partenaire → Abonnement) pour consulter les détails.`,
    ],
    helpParagraphs: [
      `Une question sur votre formule ?`,
      `Écrivez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}

export function buildPartnerSubscriptionExpiredEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  safePlanName: string;
  supportEmail: string;
}): PartnerSubscriptionLifecycleEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const plan = args.safePlanName.trim() || 'votre formule';
  const support = args.supportEmail.trim() || 'support@wise-eat.com';
  return {
    subject: `${app} — Abonnement Partner expiré`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      `Votre formule Partner <strong>${plan}</strong> sur <strong>${app}</strong> a <strong>expiré</strong>.`,
      `Souscrivez à nouveau depuis l’application pour conserver l’affiliation et vos avantages.`,
    ],
    helpParagraphs: [
      `Besoin d’aide pour renouveler ?`,
      `Contactez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}

export function buildPartnerSubscriptionTrialReminderEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  safePlanName: string;
  daysRemaining: number;
  supportEmail: string;
}): PartnerSubscriptionLifecycleEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const plan = args.safePlanName.trim() || 'votre formule';
  const days = Math.max(1, Math.floor(args.daysRemaining));
  const support = args.supportEmail.trim() || 'support@wise-eat.com';
  const when =
    days <= 1
      ? 'se termine <strong>demain</strong>'
      : `se termine dans <strong>${days} jour(s)</strong>`;
  return {
    subject:
      days <= 1
        ? `${app} — Essai Partner : dernier jour`
        : `${app} — Rappel essai Partner`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      `Votre essai Partner <strong>${plan}</strong> sur <strong>${app}</strong> ${when}.`,
      `Souscrivez avant la fin pour garder l’affiliation sans interruption.`,
    ],
    helpParagraphs: [
      `Une question sur l’essai ou les formules ?`,
      `Écrivez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}
