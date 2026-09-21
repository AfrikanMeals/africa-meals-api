/**
 * Alerte vendeur call-like — éligibilité ring / rappel / stop.
 * Distinct du push inbox `order_update` (une fois).
 */

export const VENDOR_ORDER_ALERT_FCM_TYPE = 'vendor_order_alert';
export const VENDOR_ORDER_ALERT_ANDROID_CHANNEL =
  'african_meals_vendor_order_calls';

/** Intervalle min entre rappels FCM (ms). */
export const VENDOR_ORDER_ALERT_REMIND_INTERVAL_MS = 45_000;
/** Cap rappels (hors push initial ring). */
export const VENDOR_ORDER_ALERT_MAX_REMINDERS = 40;

export type VendorOrderAlertAction = 'ring' | 'stop';

/** Commande encore en attente d’Accept/Reject vendeur. */
export function isVendorOrderAlertStillRinging(order: {
  status?: string | null;
  vendorAcceptedAt?: unknown;
}): boolean {
  const st = String(order.status ?? '')
    .trim()
    .toLowerCase();
  // Aligné isOrderStatusPaidForVendorWorkflow (paied | awaiting_cash).
  if (st !== 'paied' && st !== 'paid' && st !== 'awaiting_cash') {
    return false;
  }
  const accepted = order.vendorAcceptedAt;
  if (accepted == null) return true;
  if (accepted instanceof Date) return false;
  if (typeof accepted === 'string' && accepted.trim()) return false;
  return true;
}

/** Faut-il envoyer un rappel FCM maintenant ? */
export function shouldSendVendorOrderAlertReminder(args: {
  nowMs: number;
  lastRemindedAtMs: number | null;
  /** Première notif payée = ring initial ; compteur = rappels déjà envoyés. */
  remindCount: number;
  intervalMs?: number;
  maxReminders?: number;
}): boolean {
  const max = args.maxReminders ?? VENDOR_ORDER_ALERT_MAX_REMINDERS;
  const interval = args.intervalMs ?? VENDOR_ORDER_ALERT_REMIND_INTERVAL_MS;
  if (args.remindCount >= max) return false;
  if (args.lastRemindedAtMs == null) return true;
  return args.nowMs - args.lastRemindedAtMs >= interval;
}

export function vendorOrderAlertCollapseKey(orderId: string): string {
  return `vendor-alert-${String(orderId ?? '').trim()}`;
}
