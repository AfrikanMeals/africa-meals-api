import { jsDayOfWeekInTimezone } from '@modules/supported-countries/region-timezone.util';

/** `dailyMenuToday` + `addonsAvailability` pour un plat (menu du jour du jour courant). */

export type DailyMenuAddonsAvailabilityPayload = {
  variantIndexes?: number[];
  complements?: { groupIndex: number; optionIndexes: number[] }[];
  supplementIndexes?: number[];
};

export type DailyMenuTodayPayload = {
  onMenu: boolean;
  stockUnlimited: boolean;
  stockRemaining: number;
  soldOut: boolean;
  addonsAvailability?: DailyMenuAddonsAvailabilityPayload;
};

export function stringifyDailyMenuProductId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return (value as { toString(): string }).toString();
  }
  return String(value).trim();
}

export function dailyMenuSlotItems(
  slot: Record<string, unknown> | undefined,
): Record<string, unknown>[] {
  if (!slot) return [];
  const rawItems = slot['items'];
  if (Array.isArray(rawItems) && rawItems.length) {
    return rawItems as Record<string, unknown>[];
  }
  const pids = slot['productIds'];
  if (!Array.isArray(pids)) return [];
  return pids.map((id) => ({
    productId: id,
    stockUnlimited: true,
    stockRemaining: 0,
  }));
}

export function parseDailyMenuAddonsAvailability(
  raw: unknown,
): DailyMenuAddonsAvailabilityPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: DailyMenuAddonsAvailabilityPayload = {};
  if (Array.isArray(o.variantIndexes)) {
    out.variantIndexes = [
      ...new Set(
        o.variantIndexes
          .map((n) => Math.floor(Number(n)))
          .filter((n) => n >= 0),
      ),
    ].sort((a, b) => a - b);
  }
  if (Array.isArray(o.complements) && o.complements.length) {
    const groups = (o.complements as unknown[])
      .map((row) => {
        const r = row as Record<string, unknown>;
        return {
          groupIndex: Math.floor(Number(r.groupIndex)),
          optionIndexes: [
            ...new Set(
              (Array.isArray(r.optionIndexes) ? r.optionIndexes : [])
                .map((n) => Math.floor(Number(n)))
                .filter((n) => n >= 0),
            ),
          ].sort((a, b) => a - b),
        };
      })
      .filter((g) => g.groupIndex >= 0 && g.optionIndexes.length > 0)
      .sort((a, b) => a.groupIndex - b.groupIndex);
    if (groups.length) out.complements = groups;
  }
  if (Array.isArray(o.supplementIndexes)) {
    out.supplementIndexes = [
      ...new Set(
        o.supplementIndexes
          .map((n) => Math.floor(Number(n)))
          .filter((n) => n >= 0),
      ),
    ].sort((a, b) => a - b);
  }
  if (Object.keys(out).length === 0) return undefined;
  return out;
}

export function buildDailyMenuTodayForProduct(
  storeRaw: Record<string, unknown> | null | undefined,
  productId: string,
  at: Date = new Date(),
  timezone?: string,
): DailyMenuTodayPayload {
  const dow = timezone
    ? jsDayOfWeekInTimezone(timezone, at)
    : at.getDay();
  const rows = Array.isArray(storeRaw?.['dailyMenuByWeekday'])
    ? (storeRaw!['dailyMenuByWeekday'] as Record<string, unknown>[])
    : [];
  const slot = rows.find((r) => Number(r['dayOfWeek']) === dow);
  const items = dailyMenuSlotItems(slot);
  const pid = stringifyDailyMenuProductId(productId);
  const it = items.find(
    (x) => stringifyDailyMenuProductId(x['productId']) === pid,
  );
  if (!it) {
    return {
      onMenu: false,
      stockUnlimited: true,
      stockRemaining: 0,
      soldOut: false,
    };
  }
  const stockUnlimited = it['stockUnlimited'] !== false;
  const stockRemaining = stockUnlimited
    ? 0
    : Math.max(0, Math.floor(Number(it['stockRemaining'] ?? 0)));
  const soldOut = !stockUnlimited && stockRemaining <= 0;
  const addonsAvailability = parseDailyMenuAddonsAvailability(
    it['addonsAvailability'],
  );
  return {
    onMenu: true,
    stockUnlimited,
    stockRemaining,
    soldOut,
    ...(addonsAvailability ? { addonsAvailability } : {}),
  };
}
