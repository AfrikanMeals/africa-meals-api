/**
 * Fan-out push commande boutique : équipe vs admins plateforme.
 * Les e-mails restent hors de ce helper (jamais d’e-mail admin à chaque statut).
 */

export type StoreOrderNotifyPushFanout = {
  /**
   * FCM équipe boutique (`audience=vendor`) — vide si Push boutique OFF.
   * Exclut client + ids déjà dans adminFcmUserIds (pas de double envoi).
   */
  vendorFcmUserIds: string[];
  /**
   * FCM admins plateforme (`audience=admin`) — toujours, même si Push boutique OFF.
   * Exclut le client de la commande.
   */
  adminFcmUserIds: string[];
  /** Destinataires inbox in-app (équipe si Push ON + admins toujours). */
  inboxUserIds: string[];
  /**
   * Boutique a coupé Push Commandes : pas de FCM équipe,
   * seuls les admins plateforme restent notifiés.
   */
  adminOnlyBecauseStorePushOff: boolean;
};

function uniqueTrimmedIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function excludeUserId(ids: string[], excludeId?: string | null): string[] {
  const ex = (excludeId ?? '').trim();
  if (!ex) return uniqueTrimmedIds(ids);
  return uniqueTrimmedIds(ids).filter((id) => id !== ex);
}

function excludeIds(ids: string[], exclude: Set<string>): string[] {
  return ids.filter((id) => !exclude.has(id));
}

/**
 * Calcule qui reçoit FCM / inbox pour un changement de statut commande.
 * Fix: un toggle Push boutique OFF ne doit plus masquer les admins plateforme
 * (compte ADMIN connecté sur l’app mobile).
 * Partition : équipe → audience vendor ; admins → toujours audience admin.
 */
export function resolveStoreOrderNotifyPushFanout(args: {
  storeTeamIds: string[];
  platformAdminIds: string[];
  customerUserId?: string | null;
  storePushEnabled: boolean;
}): StoreOrderNotifyPushFanout {
  const team = uniqueTrimmedIds(args.storeTeamIds);
  const admins = uniqueTrimmedIds(args.platformAdminIds);
  const customer = (args.customerUserId ?? '').trim();

  // Admins toujours notifiés (hors client), tagués audience=admin côté FCM.
  const adminFcmUserIds = excludeUserId(admins, customer);
  const adminSet = new Set(adminFcmUserIds);

  if (args.storePushEnabled) {
    // Équipe hors client et hors admins (évite un 2e FCM vendor pour le même admin).
    const vendorFcmUserIds = excludeIds(
      excludeUserId(team, customer),
      adminSet,
    );
    const inboxCombined = uniqueTrimmedIds([...team, ...admins]);
    const inboxUserIds =
      inboxCombined.length > 0
        ? inboxCombined
        : customer
          ? [customer]
          : [];
    return {
      vendorFcmUserIds,
      adminFcmUserIds,
      inboxUserIds,
      adminOnlyBecauseStorePushOff: false,
    };
  }

  return {
    vendorFcmUserIds: [],
    adminFcmUserIds,
    inboxUserIds: adminFcmUserIds,
    adminOnlyBecauseStorePushOff: true,
  };
}
