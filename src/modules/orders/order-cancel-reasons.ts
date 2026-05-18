/** Codes motif annulation / refus commande (partagés API, admin, mobile). */
export const ORDER_CANCEL_REASON_OTHER = 'other' as const;

export const VENDOR_ORDER_CANCEL_REASON_CODES = [
  'out_of_stock',
  'store_closed',
  'cannot_deliver',
  'payment_issue',
  'duplicate_order',
  'customer_request',
  ORDER_CANCEL_REASON_OTHER,
] as const;

export const CLIENT_ORDER_CANCEL_REASON_CODES = [
  'changed_mind',
  'wrong_order',
  'too_long_wait',
  'found_elsewhere',
  'delivery_issue',
  ORDER_CANCEL_REASON_OTHER,
] as const;

export type VendorOrderCancelReasonCode =
  (typeof VENDOR_ORDER_CANCEL_REASON_CODES)[number];

export type ClientOrderCancelReasonCode =
  (typeof CLIENT_ORDER_CANCEL_REASON_CODES)[number];

export type OrderCancelReasonSource = 'vendor' | 'client' | 'admin';

const VENDOR_LABELS_FR: Record<VendorOrderCancelReasonCode, string> = {
  out_of_stock: 'Rupture de stock / article indisponible',
  store_closed: 'Restaurant fermé ou indisponible',
  cannot_deliver: 'Impossible de livrer à cette adresse',
  payment_issue: 'Problème de paiement',
  duplicate_order: 'Commande en double',
  customer_request: 'Demande du client',
  other: 'Autre',
};

const CLIENT_LABELS_FR: Record<ClientOrderCancelReasonCode, string> = {
  changed_mind: 'J’ai changé d’avis',
  wrong_order: 'Mauvaise commande / erreur',
  too_long_wait: 'Délai d’attente trop long',
  found_elsewhere: 'Trouvé ailleurs',
  delivery_issue: 'Problème de livraison',
  other: 'Autre',
};

export function isVendorOrderCancelReasonCode(
  code: string,
): code is VendorOrderCancelReasonCode {
  return (VENDOR_ORDER_CANCEL_REASON_CODES as readonly string[]).includes(code);
}

export function isClientOrderCancelReasonCode(
  code: string,
): code is ClientOrderCancelReasonCode {
  return (CLIENT_ORDER_CANCEL_REASON_CODES as readonly string[]).includes(code);
}

export function vendorOrderCancelReasonLabel(
  code: VendorOrderCancelReasonCode,
): string {
  return VENDOR_LABELS_FR[code] ?? code;
}

export function clientOrderCancelReasonLabel(
  code: ClientOrderCancelReasonCode,
): string {
  return CLIENT_LABELS_FR[code] ?? code;
}

export function resolveOrderCancelReasonDisplay(args: {
  source: OrderCancelReasonSource;
  reasonCode: string;
  customDetails?: string;
}): { code: string; details: string } {
  const code = args.reasonCode.trim();
  const extra = (args.customDetails ?? '').trim();

  if (args.source === 'client' && isClientOrderCancelReasonCode(code)) {
    if (code === ORDER_CANCEL_REASON_OTHER) {
      return { code, details: extra };
    }
    const label = clientOrderCancelReasonLabel(code);
    return {
      code,
      details: extra ? `${label} — ${extra}` : label,
    };
  }

  if (isVendorOrderCancelReasonCode(code)) {
    if (code === ORDER_CANCEL_REASON_OTHER) {
      return { code, details: extra };
    }
    const label = vendorOrderCancelReasonLabel(code);
    return {
      code,
      details: extra ? `${label} — ${extra}` : label,
    };
  }

  return { code, details: extra || code };
}

export function assertOrderCancelReasonPayload(args: {
  source: OrderCancelReasonSource;
  reasonCode: string;
  customDetails?: string;
}): void {
  const code = args.reasonCode.trim();
  if (!code) {
    throw new Error('cancel_reason_code_required');
  }
  const extra = (args.customDetails ?? '').trim();

  if (args.source === 'client') {
    if (!isClientOrderCancelReasonCode(code)) {
      throw new Error('cancel_reason_code_invalid');
    }
  } else if (!isVendorOrderCancelReasonCode(code)) {
    throw new Error('cancel_reason_code_invalid');
  }

  if (code === ORDER_CANCEL_REASON_OTHER && extra.length < 10) {
    throw new Error('cancel_reason_details_required');
  }
}
