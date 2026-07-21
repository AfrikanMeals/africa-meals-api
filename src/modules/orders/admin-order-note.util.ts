/** Normalise une note admin (trim + plafond schéma). */
export function normalizeAdminOrderNote(raw: string): string {
  return String(raw ?? '')
    .trim()
    .slice(0, 2000);
}

function orderRef(orderId: string): string {
  const id = orderId.trim();
  return id.length > 6 ? id.slice(-6).toUpperCase() : id.toUpperCase();
}

/** Message inbox vendeur — note admin liée à une commande. */
export function buildAdminOrderNoteInboxMessage(args: {
  orderId: string;
  note: string;
}): string {
  const ref = orderRef(args.orderId);
  const note = normalizeAdminOrderNote(args.note);
  return `Note admin · #${ref}\n${note}`.slice(0, 4000);
}

/** Push FCM vendeur — note admin. */
export function buildAdminOrderNotePush(args: {
  orderId: string;
  note: string;
  storeName?: string;
}): { title: string; body: string; reason: string } {
  const store = (args.storeName ?? '').trim() || 'Boutique';
  const ref = orderRef(args.orderId);
  const note = normalizeAdminOrderNote(args.note);
  return {
    title: 'Note admin',
    body: `${store} : note sur #${ref} — ${note}`.slice(0, 240),
    reason: 'admin_order_note',
  };
}
