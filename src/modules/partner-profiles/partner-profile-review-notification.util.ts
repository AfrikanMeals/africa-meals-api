/** Statuts notifiés pour revue fiche Partner (inbox + FCM). */
export type PartnerProfileReviewNotifyStatus =
  | 'APPROVED'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'REACTIVATED';

export type PartnerProfileReviewNotificationCopy = {
  title: string;
  body: string;
};

/**
 * Copie inbox / push pour un changement de statut de fiche Partner.
 * Pure — testable sans Nest / FCM.
 */
export function buildPartnerProfileReviewNotificationCopy(args: {
  status: PartnerProfileReviewNotifyStatus;
  rejectionReason?: string | null;
  /** Code parrainage 6 chars — inclus dans le corps si APPROVED. */
  referralCode?: string | null;
}): PartnerProfileReviewNotificationCopy {
  const reason = String(args.rejectionReason ?? '').trim();
  // Normalise pour affichage push / inbox (évite espaces / casse mixte).
  const referral = String(args.referralCode ?? '')
    .trim()
    .toUpperCase();
  switch (args.status) {
    case 'APPROVED':
      return {
        title: 'Fiche partenaire approuvée',
        body: referral
          ? `Votre fiche partenaire a été approuvée. Votre code de parrainage : ${referral}. Partagez-le pour le programme Affiliation.`
          : 'Votre fiche partenaire a été approuvée. Elle est visible pour le programme Affiliation.',
      };
    case 'REACTIVATED':
      return {
        title: 'Fiche partenaire réactivée',
        body: 'Votre fiche partenaire a été réactivée. Vous retrouvez l’accès au mode partenaire.',
      };
    case 'SUSPENDED':
      return {
        title: 'Fiche partenaire suspendue',
        body: reason
          ? `Votre fiche partenaire a été suspendue. Motif : ${reason}`
          : 'Votre fiche partenaire a été suspendue. Contactez le support pour plus d’informations.',
      };
    case 'REJECTED':
      return {
        title: 'Fiche partenaire refusée',
        body: reason
          ? `Votre fiche partenaire a été refusée. Motif : ${reason}`
          : 'Votre fiche partenaire a été refusée. Vous pouvez la corriger et la soumettre à nouveau.',
      };
    default:
      return {
        title: 'Mise à jour fiche partenaire',
        body: 'Le statut de votre fiche partenaire a changé.',
      };
  }
}

/** Type canonique inbox / FCM data.type. */
export const PARTNER_PROFILE_REVIEW_NOTIFICATION_TYPE =
  'partner_profile_review';
