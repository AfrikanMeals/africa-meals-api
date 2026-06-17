import { normalizePickupCodeInput } from './pickup-code';

export type OrderHandoffQrPayload = {
  v: 1;
  oid: string;
  code: string;
};

export function encodeOrderHandoffQrPayload(
  orderId: string,
  pickupCode: string,
): string {
  const payload: OrderHandoffQrPayload = {
    v: 1,
    oid: orderId.trim(),
    code: normalizePickupCodeInput(pickupCode),
  };
  return JSON.stringify(payload);
}

export function decodeOrderHandoffQrPayload(raw: string): {
  orderId?: string;
  code: string;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const oid = String(parsed.oid ?? parsed.orderId ?? '').trim();
      const code = normalizePickupCodeInput(
        String(parsed.code ?? parsed.pickupCode ?? ''),
      );
      if (code.length >= 4) {
        return { orderId: oid || undefined, code };
      }
    } catch {
      /* legacy fallback below */
    }
  }

  const legacy = normalizePickupCodeInput(trimmed);
  if (legacy.length >= 4 && legacy.length <= 12) {
    return { code: legacy };
  }

  return null;
}
