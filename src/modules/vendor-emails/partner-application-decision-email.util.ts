/**
 * Copie e-mails décision candidature partenaire — pure pour tests.
 * Les valeurs nom / motif / code sont déjà échappées HTML côté service.
 */

export type PartnerApplicationDecisionEmailCopy = {
  subject: string;
  greetingLine: string;
  bodyParagraphs: string[];
  /** Bloc dédié code referral (approve uniquement). */
  referralParagraphs?: string[];
  helpParagraphs: string[];
};

/** E-mail d’approbation : inclut le code referral 6 caractères. */
export function buildPartnerApplicationApprovedEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  safeReferralCode: string;
  supportEmail: string;
}): PartnerApplicationDecisionEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const code = args.safeReferralCode.trim();
  const support = args.supportEmail.trim() || 'support@wise-eat.com';

  return {
    subject: `${app} — Candidature partenaire acceptée`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      `Bonne nouvelle : votre candidature <strong>partenaire</strong> sur <strong>${app}</strong> a été <strong>acceptée</strong>.`,
      `Vous pouvez désormais basculer en mode partenaire dans l'application et compléter votre fiche.`,
    ],
    referralParagraphs: [
      `Votre <strong>code de parrainage</strong> personnel est :`,
      `<strong style="font-size:22px;letter-spacing:0.18em">${code}</strong>`,
      `Partagez ce code (6 caractères) pour faire connaître ${app} auprès de votre réseau.`,
    ],
    helpParagraphs: [
      `Une question sur votre compte partenaire ?`,
      `Écrivez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}

/** E-mail de refus : motif admin inclus. */
export function buildPartnerApplicationRejectedEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  safeRejectionReason: string;
  supportEmail: string;
}): PartnerApplicationDecisionEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Candidat';
  const reason = args.safeRejectionReason.trim() || 'Non précisé';
  const support = args.supportEmail.trim() || 'support@wise-eat.com';

  return {
    subject: `${app} — Candidature partenaire refusée`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      `Nous avons examiné votre candidature <strong>partenaire</strong> sur <strong>${app}</strong>.`,
      `Malheureusement, elle n'a pas pu être acceptée pour le moment.`,
      `<strong>Motif :</strong> ${reason}`,
      `Vous pouvez mettre à jour votre dossier et soumettre à nouveau une candidature depuis l'application.`,
    ],
    helpParagraphs: [
      `Besoin de précisions ?`,
      `Contactez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}
