import { jsDayOfWeekInTimezone } from '@modules/supported-countries/region-timezone.util';

/** Menu du jour normalisé (partagé panier + validation checkout). */

export type DailyMenuNormalizedItem = {
  productId: string;
  stockUnlimited: boolean;
  stockRemaining: number;
  soldOut: boolean;
};

export type DailyMenuNormalizedSlot = {
  dayOfWeek: number;
  items: DailyMenuNormalizedItem[];
};

export type DailyMenuProductCap =
  | { kind: 'no_menu_today' }
  | { kind: 'unlimited' }
  | { kind: 'limited'; max: number }
  | { kind: 'not_on_menu' };

export function stringifyDailyMenuId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return (value as { toString(): string }).toString();
  }
  return String(value).trim();
}

export function normalizeDailyMenuForApi(
  rows: Array<Record<string, unknown>> | undefined | null,
): DailyMenuNormalizedSlot[] {
  if (!rows?.length) return [];
  return rows.map((row) => {
    const dayOfWeek = Math.min(
      6,
      Math.max(0, Number((row as { dayOfWeek?: number }).dayOfWeek ?? 0)),
    );
    const items: DailyMenuNormalizedItem[] = [];
    const rawItems = (row as { items?: unknown[] }).items;
    if (Array.isArray(rawItems) && rawItems.length) {
      for (const it of rawItems) {
        const o = it as Record<string, unknown>;
        const pid = stringifyDailyMenuId(o.productId);
        if (!pid) continue;
        const stockUnlimited = o.stockUnlimited !== false;
        const stockRemaining = stockUnlimited
          ? 0
          : Math.max(0, Math.floor(Number(o.stockRemaining ?? 0)));
        items.push({
          productId: pid,
          stockUnlimited,
          stockRemaining,
          soldOut: !stockUnlimited && stockRemaining <= 0,
        });
      }
    } else {
      const pids = (row as { productIds?: unknown[] }).productIds;
      if (Array.isArray(pids)) {
        for (const id of pids) {
          const pid = stringifyDailyMenuId(id);
          if (!pid) continue;
          items.push({
            productId: pid,
            stockUnlimited: true,
            stockRemaining: 0,
            soldOut: false,
          });
        }
      }
    }
    return { dayOfWeek, items };
  });
}

export function todayDailyMenuSlot(
  rows: Array<Record<string, unknown>> | undefined | null,
  dow?: number,
  timezone?: string,
): DailyMenuNormalizedSlot | null {
  const day =
    dow ??
    (timezone ? jsDayOfWeekInTimezone(timezone) : new Date().getDay());
  const normalized = normalizeDailyMenuForApi(rows ?? []);
  const slot = normalized.find((r) => r.dayOfWeek === day);
  if (!slot?.items?.length) return null;
  return slot;
}

export function resolveDailyMenuProductCap(
  rows: Array<Record<string, unknown>> | undefined | null,
  productId: string,
  timezone?: string,
  dow?: number,
): DailyMenuProductCap {
  const slot = todayDailyMenuSlot(rows, dow, timezone);
  if (!slot) {
    return { kind: 'no_menu_today' };
  }
  const pid = stringifyDailyMenuId(productId);
  const entry = slot.items.find((i) => i.productId === pid);
  if (!entry) {
    return { kind: 'not_on_menu' };
  }
  if (entry.stockUnlimited) {
    return { kind: 'unlimited' };
  }
  if (entry.soldOut) {
    return { kind: 'limited', max: 0 };
  }
  return { kind: 'limited', max: entry.stockRemaining };
}

/** `null` = pas de plafond menu du jour (illimité ou pas de menu actif). */
export function dailyMenuStockRemainingForStoreProduct(
  store: { dailyMenuByWeekday?: unknown; timezone?: string },
  productId: string,
  timezone?: string,
): number | null {
  const cap = resolveDailyMenuProductCap(
    Array.isArray(store.dailyMenuByWeekday)
      ? (store.dailyMenuByWeekday as Record<string, unknown>[])
      : [],
    productId,
    timezone ?? store.timezone,
  );
  if (cap.kind === 'unlimited' || cap.kind === 'no_menu_today') {
    return null;
  }
  if (cap.kind === 'not_on_menu') {
    return null;
  }
  return cap.max;
}
