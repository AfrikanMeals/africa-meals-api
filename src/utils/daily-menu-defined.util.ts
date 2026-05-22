/** Vérifie si une boutique a au moins un plat au menu du jour pour un jour (0 = dimanche … 6 = samedi). */
export function storeHasDailyMenuForWeekday(
  rows: unknown,
  dayOfWeek: number,
): boolean {
  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }
  const target = Math.min(6, Math.max(0, Math.floor(dayOfWeek)));
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const dow = Math.min(
      6,
      Math.max(0, Math.floor(Number(r.dayOfWeek ?? -1))),
    );
    if (dow !== target) continue;

    const items = r.items;
    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const pid = (it as { productId?: unknown }).productId;
        if (pid != null && String(pid).trim() !== '') {
          return true;
        }
      }
    }

    const productIds = r.productIds;
    if (Array.isArray(productIds)) {
      for (const id of productIds) {
        if (id != null && String(id).trim() !== '') {
          return true;
        }
      }
    }
  }
  return false;
}
