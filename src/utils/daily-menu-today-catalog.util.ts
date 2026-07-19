import { jsDayOfWeekInTimezone } from '@modules/supported-countries/region-timezone.util';
import {
  DailyMenuTodayPayload,
  stringifyDailyMenuProductId,
} from '@utils/daily-menu-today-product.util';

export type DailyMenuCatalogKind = 'drink' | 'bundle';

/** Items boisson/bundle du slot jour (`drinkItems` / `bundleItems`). */
export function dailyMenuSlotCatalogItems(
  slot: Record<string, unknown> | undefined,
  kind: DailyMenuCatalogKind,
): Record<string, unknown>[] {
  if (!slot) return [];
  const key = kind === 'drink' ? 'drinkItems' : 'bundleItems';
  const raw = slot[key];
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

function catalogItemIdKey(kind: DailyMenuCatalogKind): string {
  return kind === 'drink' ? 'drinkId' : 'bundleId';
}

function findWeekdaySlot(
  storeRaw: Record<string, unknown> | null | undefined,
  at: Date,
  timezone?: string,
): Record<string, unknown> | undefined {
  const dow = timezone
    ? jsDayOfWeekInTimezone(timezone, at)
    : at.getDay();
  const rows = Array.isArray(storeRaw?.['dailyMenuByWeekday'])
    ? (storeRaw!['dailyMenuByWeekday'] as Record<string, unknown>[])
    : [];
  return rows.find((r) => Number(r['dayOfWeek']) === dow);
}

/** `dailyMenuToday` pour une boisson ou un bundle (jour courant TZ boutique). */
export function buildDailyMenuTodayForCatalogItem(
  storeRaw: Record<string, unknown> | null | undefined,
  itemId: string,
  kind: DailyMenuCatalogKind,
  at: Date = new Date(),
  timezone?: string,
): DailyMenuTodayPayload {
  const slot = findWeekdaySlot(storeRaw, at, timezone);
  const items = dailyMenuSlotCatalogItems(slot, kind);
  const idKey = catalogItemIdKey(kind);
  const pid = stringifyDailyMenuProductId(itemId);
  const it = items.find(
    (x) => stringifyDailyMenuProductId(x[idKey]) === pid,
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
  return {
    onMenu: true,
    stockUnlimited,
    stockRemaining,
    soldOut,
  };
}

/**
 * Si le jour a une liste non vide (`drinkItems` / `bundleItems`) → ne garder
 * que les items onMenu et non sold-out (+ annoter `dailyMenuToday`).
 * Liste vide → pas de restriction menu du jour (catalogue inchangé).
 */
export function applyDailyMenuAvailabilityToCatalogItems<
  T extends { id: string },
>(
  items: T[],
  storeRaw: Record<string, unknown> | null | undefined,
  kind: DailyMenuCatalogKind,
  at: Date = new Date(),
  timezone?: string,
): Array<T & { dailyMenuToday?: DailyMenuTodayPayload }> {
  const slot = findWeekdaySlot(storeRaw, at, timezone);
  const slotItems = dailyMenuSlotCatalogItems(slot, kind);
  // Aucune sélection jour → catalogue complet (comme checkout bundles).
  if (slotItems.length === 0) {
    return items.map((item) => ({ ...item }));
  }
  const out: Array<T & { dailyMenuToday: DailyMenuTodayPayload }> = [];
  for (const item of items) {
    const dailyMenuToday = buildDailyMenuTodayForCatalogItem(
      storeRaw,
      item.id,
      kind,
      at,
      timezone,
    );
    if (!dailyMenuToday.onMenu || dailyMenuToday.soldOut) continue;
    out.push({ ...item, dailyMenuToday });
  }
  return out;
}

/** True si le jour restreint les boissons/bundles (liste non vide). */
export function isDailyMenuCatalogRestricted(
  storeRaw: Record<string, unknown> | null | undefined,
  kind: DailyMenuCatalogKind,
  at: Date = new Date(),
  timezone?: string,
): boolean {
  const slot = findWeekdaySlot(storeRaw, at, timezone);
  return dailyMenuSlotCatalogItems(slot, kind).length > 0;
}
