/**
 * Copie e-mail « fiche partenaire soumise » — pure pour tests anti-régression.
 * Les balises HTML sont injectées côté service (escape déjà fait sur les noms).
 */

export type PartnerProfileSubmittedEmailCopy = {
  subject: string;
  greetingLine: string;
  introParagraphs: string[];
  nextStepsParagraphs: string[];
  helpParagraphs: string[];
};

/** Construit sujet + paragraphes de confirmation après POST /partner/profile/submit. */
export function buildPartnerProfileSubmittedEmailCopy(args: {
  appName: string;
  /** Nom déjà échappé HTML si utilisé dans un template HTML. */
  safeDisplayName: string;
  supportEmail: string;
}): PartnerProfileSubmittedEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const support = args.supportEmail.trim() || 'support@wise-eat.com';

  return {
    subject: `${app} — Fiche partenaire reçue`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    introParagraphs: [
      `Nous avons bien reçu votre <strong>fiche partenaire</strong> sur <strong>${app}</strong>. Merci d'avoir complété votre dossier.`,
      `Notre équipe va examiner vos informations (identité, adresse et réseaux). Vous serez notifié dès qu'une suite sera donnée.`,
    ],
    nextStepsParagraphs: [
      `En attendant, gardez l'application à jour pour suivre l'avancement de votre espace partenaire.`,
      `Vous pouvez toujours consulter ou mettre à jour votre fiche depuis le profil partenaire dans l'app.`,
    ],
    helpParagraphs: [
      `Une question sur votre dossier ?`,
      `Écrivez-nous à <a href="mailto:${support}">${support}</a> — nous vous répondrons rapidement.`,
    ],
  };
}
