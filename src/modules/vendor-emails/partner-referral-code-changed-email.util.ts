/**
 * Copie e-mail — admin a changé / défini le code parrainage Partner.
 * Valeurs nom / codes déjà échappées HTML côté service.
 */

export type PartnerReferralCodeChangedEmailCopy = {
  subject: string;
  greetingLine: string;
  bodyParagraphs: string[];
  referralParagraphs: string[];
  helpParagraphs: string[];
};

export function buildPartnerReferralCodeChangedEmailCopy(args: {
  appName: string;
  safeDisplayName: string;
  safeReferralCode: string;
  safePreviousReferralCode?: string;
  supportEmail: string;
}): PartnerReferralCodeChangedEmailCopy {
  const app = args.appName.trim() || 'Wise Eat';
  const name = args.safeDisplayName.trim() || 'Partenaire';
  const next = args.safeReferralCode.trim();
  const prev = String(args.safePreviousReferralCode ?? '').trim();
  const support = args.supportEmail.trim() || 'support@wise-eat.com';

  const referralParagraphs = prev && prev !== next
    ? [
        `Ancien code : <strong>${prev}</strong>`,
        `Nouveau code : <strong>${next}</strong>`,
        `Utilisez uniquement le nouveau code pour le programme Affiliation.`,
      ]
    : [
        `Votre code de parrainage : <strong>${next}</strong>`,
        `Partagez-le pour le programme Affiliation.`,
      ];

  return {
    subject: `${app} — Code de parrainage mis à jour`,
    greetingLine: `Bonjour <strong>${name}</strong>,`,
    bodyParagraphs: [
      prev && prev !== next
        ? `L’équipe <strong>${app}</strong> a <strong>modifié</strong> votre code de parrainage Partner.`
        : `L’équipe <strong>${app}</strong> a <strong>défini</strong> votre code de parrainage Partner.`,
      `Retrouvez-le aussi dans l’application (mode partenaire → Parrainage).`,
    ],
    referralParagraphs,
    helpParagraphs: [
      `Une question sur votre code ?`,
      `Écrivez-nous à <a href="mailto:${support}">${support}</a>.`,
    ],
  };
}
