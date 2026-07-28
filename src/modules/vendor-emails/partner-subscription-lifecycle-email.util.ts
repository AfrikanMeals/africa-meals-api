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

/** Copie e-mail : formule privée créée (pas encore assignée). */
export function buildPartnerCustomPlanCreatedEmailCopy(args: {
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
    subject: `${app} — Formule Partner personnalisée`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      `${app} a créé une <strong>formule personnalisée</strong> pour vous : <strong>${plan}</strong>.`,
      `Elle apparaît dans votre catalogue Abonnement Partner. Vous pourrez la souscrire ou l’activer dès qu’elle vous sera proposée.`,
      `Ouvrez l’application (mode partenaire → Abonnement) pour la consulter.`,
    ],
    helpParagraphs: [
      `Une question sur votre formule ?`,
      `Écrivez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}

/** Copie e-mail offre admin (assignation gratuite d’une formule). */
export function buildPartnerSubscriptionOfferEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  safePlanName: string;
  supportEmail: string;
  safeOfferNote?: string;
  periodLabel?: string;
  startsLabel?: string;
  endsLabel?: string;
}): PartnerSubscriptionLifecycleEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const plan = args.safePlanName.trim() || 'votre formule';
  const support = args.supportEmail.trim() || 'support@wise-eat.com';
  const period = (args.periodLabel ?? '').trim();
  const starts = (args.startsLabel ?? '').trim();
  const ends = (args.endsLabel ?? '').trim();
  const note = (args.safeOfferNote ?? '').trim();
  const bodyParagraphs = [
    `${app} vous offre l’abonnement Partner <strong>${plan}</strong>.`,
  ];
  if (period) {
    bodyParagraphs.push(`Facturation : <strong>${period}</strong>.`);
  }
  if (starts && ends) {
    bodyParagraphs.push(
      `Période : du <strong>${starts}</strong> au <strong>${ends}</strong>.`,
    );
  }
  if (note) {
    bodyParagraphs.push(`Message : ${note}`);
  } else {
    bodyParagraphs.push(
      `Profitez de votre accès affiliation selon les dates indiquées dans l’application.`,
    );
  }
  bodyParagraphs.push(
    `Ouvrez l’application (mode partenaire → Abonnement) pour consulter les détails.`,
  );
  return {
    subject: `${app} — Offre d’abonnement Partner`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs,
    helpParagraphs: [
      `Une question sur votre offre ?`,
      `Écrivez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}

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
