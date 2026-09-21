/**
 * Résolution des parties d’une commande offerte (cadeau panier).
 * Distinct des gift codes marketing (`giftCode`).
 */

export type GiftOrderParties = {
  /** Client de la commande (`order.user`). */
  orderUserId: string;
  /** Offreur qui paie (`order.paidBy`) — absent si pas cadeau. */
  paidByUserId?: string;
  isGift: boolean;
};

/**
 * Détermine user / paidBy à partir du payeur JWT et d’un destinataire optionnel.
 * Ne charge pas Mongo : l’appelant valide l’existence du destinataire.
 */
export function resolveGiftOrderParties(args: {
  payerUserId: string;
  giftRecipientUserId?: string | null;
}): GiftOrderParties {
  const payer = String(args.payerUserId ?? '').trim();
  const recipient = String(args.giftRecipientUserId ?? '').trim();
  // Pas de destinataire → comportement historique (client = payeur).
  if (!recipient) {
    return { orderUserId: payer, isGift: false };
  }
  // Self-gift interdit (message stable API).
  if (recipient === payer) {
    throw new Error('cannot_gift_self');
  }
  return {
    orderUserId: recipient,
    paidByUserId: payer,
    isGift: true,
  };
}

/** Normalise un id Mongo pour metadata Stripe (chaîne 24 hex). */
export function giftOrderStripeMetadataChunk(args: {
  giftRecipientUserId?: string | null;
  paidByUserId?: string | null;
}): Record<string, string> {
  const recipient = String(args.giftRecipientUserId ?? '').trim();
  const paidBy = String(args.paidByUserId ?? '').trim();
  if (!recipient || !paidBy) return {};
  return {
    gift_recipient_user_id: recipient,
    paid_by_user_id: paidBy,
  };
}

/**
 * Clause Mongo liste client (`asCustomer`).
 * - giftedByMe : cadeaux offerts par moi (`paidBy = me`, `user ≠ me`).
 * - sinon (Toutes) : destinataire **ou** offreur — aligné ACL détail.
 */
export function buildCustomerOrdersListPartyFilter(args: {
  meOid: unknown;
  giftedByMe: boolean;
}): Record<string, unknown> {
  const me = args.meOid;
  if (args.giftedByMe) {
    return {
      paidBy: me,
      user: { $ne: me },
    };
  }
  // Toutes : mes commandes + cadeaux que j’ai payés pour quelqu’un d’autre.
  return {
    $or: [{ user: me }, { paidBy: me }],
  };
}
