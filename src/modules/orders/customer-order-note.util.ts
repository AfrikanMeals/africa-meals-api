/** Normalise une note client (trim + plafond schéma). */
export function normalizeCustomerOrderNote(raw: string): string {
  return String(raw ?? '')
    .trim()
    .slice(0, 2000);
}

function orderRef(orderId: string): string {
  const id = orderId.trim();
  return id.length > 6 ? id.slice(-6).toUpperCase() : id.toUpperCase();
}

/** Message inbox vendeur — note client liée à une commande. */
export function buildCustomerOrderNoteInboxMessage(args: {
  orderId: string;
  note: string;
}): string {
  const ref = orderRef(args.orderId);
  const note = normalizeCustomerOrderNote(args.note);
  return `Note client · #${ref}\n${note}`.slice(0, 4000);
}

/** Push FCM vendeur — note client. */
export function buildCustomerOrderNotePush(args: {
  orderId: string;
  note: string;
  storeName?: string;
}): { title: string; body: string; reason: string } {
  const store = (args.storeName ?? '').trim() || 'Boutique';
  const ref = orderRef(args.orderId);
  const note = normalizeCustomerOrderNote(args.note);
  return {
    title: 'Note client',
    body: `${store} : note client sur #${ref} — ${note}`.slice(0, 240),
    reason: 'customer_order_note',
  };
}

/** Statuts où le client peut encore modifier sa note. */
export function customerOrderNoteAllowedStatuses(
  status: string,
): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return s !== 'cancelled' && s !== 'completed';
}
