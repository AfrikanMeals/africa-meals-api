/** Type canonique inbox / FCM — admin a modifié le code parrainage Partner. */
export const PARTNER_REFERRAL_CODE_CHANGED_NOTIFICATION_TYPE =
  'partner_referral_code_changed';

export type PartnerReferralCodeChangedNotificationCopy = {
  title: string;
  body: string;
  type: string;
};

/**
 * Copie inbox / push quand l’admin assigne ou remplace le code referral.
 * Pure — testable sans Nest / FCM.
 */
export function buildPartnerReferralCodeChangedNotificationCopy(args: {
  referralCode: string;
  previousReferralCode?: string | null;
}): PartnerReferralCodeChangedNotificationCopy {
  // Normalise pour affichage (évite casse mixte / espaces).
  const next = String(args.referralCode ?? '')
    .trim()
    .toUpperCase();
  const prev = String(args.previousReferralCode ?? '')
    .trim()
    .toUpperCase();

  if (!next) {
    return {
      type: PARTNER_REFERRAL_CODE_CHANGED_NOTIFICATION_TYPE,
      title: 'Code de parrainage',
      body: 'Votre code de parrainage Partner a été mis à jour.',
    };
  }

  // Remplacement : mentionner l’ancien code pour éviter la confusion Affiliation.
  if (prev && prev !== next) {
    return {
      type: PARTNER_REFERRAL_CODE_CHANGED_NOTIFICATION_TYPE,
      title: 'Code de parrainage mis à jour',
      body: `Votre code de parrainage a été modifié par l’équipe. Nouveau code : ${next} (ancien : ${prev}).`,
    };
  }

  // Première attribution via action admin (pas encore de code).
  return {
    type: PARTNER_REFERRAL_CODE_CHANGED_NOTIFICATION_TYPE,
    title: 'Code de parrainage défini',
    body: `Votre code de parrainage Partner est ${next}. Partagez-le pour le programme Affiliation.`,
  };
}
