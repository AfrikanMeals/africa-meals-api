/**
 * Copie e-mails décision fiche partenaire (admin Approuver / Refuser).
 * Distinct de la candidature Collaborations — pure pour tests.
 */

export type PartnerProfileDecisionEmailCopy = {
  subject: string;
  greetingLine: string;
  bodyParagraphs: string[];
  nextStepsParagraphs?: string[];
  /** Bloc code parrainage (approve fiche uniquement). */
  referralParagraphs?: string[];
  helpParagraphs: string[];
};

/** E-mail après APPROVED sur `partner_profiles` (compte déjà PARTNER). */
export function buildPartnerProfileApprovedEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  supportEmail: string;
  /** Code 6 chars déjà échappé HTML côté service. */
  safeReferralCode: string;
}): PartnerProfileDecisionEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const support = args.supportEmail.trim() || 'support@wise-eat.com';
  const code = args.safeReferralCode.trim();

  return {
    subject: `${app} — Fiche partenaire approuvée`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      `Bonne nouvelle : votre <strong>fiche partenaire</strong> sur <strong>${app}</strong> a été <strong>approuvée</strong>.`,
      `Votre dossier (identité, adresse et réseaux) est validé. Vous pouvez utiliser pleinement votre espace partenaire dans l'application.`,
    ],
    referralParagraphs: code
      ? [
          `Votre <strong>code de parrainage</strong> personnel est :`,
          `<strong style="font-size:22px;letter-spacing:0.18em">${code}</strong>`,
          `Partagez ce code (6 caractères) pour faire connaître ${app} auprès de votre réseau.`,
        ]
      : undefined,
    nextStepsParagraphs: [
      `Ouvrez le mode partenaire pour suivre votre activité, votre affiliation et vos paramètres.`,
      `Pensez à garder vos informations à jour depuis le profil partenaire si quelque chose change.`,
    ],
    helpParagraphs: [
      `Une question sur votre fiche ou votre compte partenaire ?`,
      `Écrivez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}

/** E-mail après REJECTED — motif admin ; le partenaire peut corriger et re-soumettre. */
export function buildPartnerProfileRejectedEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  safeRejectionReason: string;
  supportEmail: string;
}): PartnerProfileDecisionEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const reason = args.safeRejectionReason.trim() || 'Non précisé';
  const support = args.supportEmail.trim() || 'support@wise-eat.com';

  return {
    subject: `${app} — Fiche partenaire refusée`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      `Nous avons examiné votre <strong>fiche partenaire</strong> sur <strong>${app}</strong>.`,
      `Malheureusement, elle n'a pas pu être approuvée pour le moment.`,
      `<strong>Motif :</strong> ${reason}`,
      `Vous pouvez corriger votre dossier et la soumettre à nouveau depuis l'application.`,
    ],
    helpParagraphs: [
      `Besoin de précisions ?`,
      `Contactez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}
