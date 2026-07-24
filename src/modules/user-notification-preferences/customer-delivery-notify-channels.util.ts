/**
 * Canaux client pour alertes livraison (Livreur proche / client absent).
 * Aligné sur l’écran mobile : Livraison + Push / E-mail.
 *
 * Champs absents (`undefined`) → allow (legacy / pas encore sync mobile).
 * `false` explicite → bloque le canal.
 */

export type CustomerDeliveryNotifyChannel = 'push' | 'email';

export type CustomerDeliveryChannelPrefs = {
  /** Opt-in global push (`pref_notif_push`). */
  pushEnabled?: boolean | null;
  /** Opt-in alertes e-mail (`pref_notif_email`). */
  emailAlertsEnabled?: boolean | null;
  /** Catégorie Livraison / statut (`pref_notif_shipping_delivery`). */
  shippingDeliveryEnabled?: boolean | null;
};

/** Catégorie Livraison activée (défaut true si non sync). */
export function isShippingDeliveryCategoryEnabled(
  prefs: CustomerDeliveryChannelPrefs | null | undefined,
): boolean {
  if (!prefs) return true;
  return prefs.shippingDeliveryEnabled !== false;
}

/**
 * Autorise l’envoi sur un canal pour une alerte livraison.
 * Exige catégorie Livraison + canal (push ou e-mail) non désactivé.
 */
export function isCustomerDeliveryChannelAllowed(
  prefs: CustomerDeliveryChannelPrefs | null | undefined,
  channel: CustomerDeliveryNotifyChannel,
): boolean {
  if (!isShippingDeliveryCategoryEnabled(prefs)) return false;
  if (!prefs) return true;
  if (channel === 'push') {
    return prefs.pushEnabled !== false;
  }
  return prefs.emailAlertsEnabled !== false;
}
