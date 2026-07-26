/**
 * Clés d’idempotency Stripe Connect transfers.
 *
 * Une clé fixe `transfer-order-delivery-{orderId}` casse dès que le montant,
 * la destination ou la charge change entre deux retries (frais recalculés,
 * compte Connect mis à jour, etc.) — Stripe renvoie alors :
 * « Keys for idempotent requests can only be used with the same parameters… ».
 */

export type ConnectTransferIdempotencyKind =
  | 'vendor'
  | 'delivery'
  | 'delivery-tip'
  /** Top-up Fee Coverage PLATFORM (sans source_transaction). */
  | 'gift-topup';

/** Construit une clé ≤ 255 car. incluant les paramètres critiques du transfer. */
export function buildConnectTransferIdempotencyKey(args: {
  kind: ConnectTransferIdempotencyKind;
  orderId: string;
  amountCents: number;
  destination: string;
  chargeId: string;
}): string {
  const orderId = String(args.orderId ?? '').trim();
  const amount = Math.max(0, Math.round(Number(args.amountCents) || 0));
  const dest = String(args.destination ?? '').trim().slice(-16);
  const charge = String(args.chargeId ?? '').trim().slice(-16);
  return `tr-${args.kind}-${orderId}-${amount}-${dest}-${charge}`.slice(0, 255);
}

/** Détecte le conflit Stripe « même clé, paramètres différents ». */
export function isStripeIdempotencyMismatchError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    type?: string;
    code?: string;
    message?: string;
    rawType?: string;
  };
  const type = String(e.type ?? e.rawType ?? '').toLowerCase();
  if (type === 'idempotency_error') return true;
  const code = String(e.code ?? '').toLowerCase();
  if (code === 'idempotency_error' || code === 'idempotency_key_in_use') {
    return true;
  }
  const msg = String(e.message ?? (err instanceof Error ? err.message : ''));
  return (
    /keys for idempotent requests can only be used with the same parameters/i.test(
      msg,
    ) ||
    (/idempotenc/i.test(msg) && /same parameters/i.test(msg))
  );
}
