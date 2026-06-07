import { createHash } from 'node:crypto';
import type {
  NormalizedLineComplementGroup,
  NormalizedLineSupplement,
} from '@schemas/order-line-customization.schema';

export function normalizeSelectedComplements(
  raw: unknown,
): NormalizedLineComplementGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedLineComplementGroup[] = [];
  for (const g of raw) {
    const row = (g ?? {}) as Record<string, unknown>;
    const groupTitle = String(
      row.groupTitle ?? row.group_title ?? '',
    ).trim();
    if (!groupTitle) continue;
    const rawOpts = Array.isArray(row.options) ? row.options : [];
    const options = rawOpts
      .map((o) => {
        const opt = (o ?? {}) as Record<string, unknown>;
        const label = String(opt.label ?? '').trim();
        if (!label) return null;
        const numeric = Number(opt.priceDelta ?? opt.price_delta ?? 0);
        const priceDelta =
          Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
        return { label, priceDelta };
      })
      .filter(
        (o): o is { label: string; priceDelta: number } => Boolean(o),
      );
    if (!options.length) continue;
    out.push({ groupTitle, options });
  }
  return out;
}

export function normalizeSelectedSupplements(
  raw: unknown,
): NormalizedLineSupplement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const row = (s ?? {}) as Record<string, unknown>;
      const name = String(row.name ?? '').trim();
      if (!name) return null;
      const numeric = Number(row.price ?? 0);
      const price = Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
      return { name, price };
    })
    .filter((s): s is NormalizedLineSupplement => Boolean(s));
}

/** Ordre stable pour que deux sélections identiques produisent la même clé. */
export function canonicalizeCustomizationSelections(
  complements: NormalizedLineComplementGroup[],
  supplements: NormalizedLineSupplement[],
): {
  c: NormalizedLineComplementGroup[];
  s: NormalizedLineSupplement[];
} {
  const c = [...complements]
    .sort((a, b) => a.groupTitle.localeCompare(b.groupTitle))
    .map((g) => ({
      groupTitle: g.groupTitle,
      options: [...g.options].sort((a, b) => a.label.localeCompare(b.label)),
    }));
  const s = [...supplements].sort((a, b) => a.name.localeCompare(b.name));
  return { c, s };
}

export function normalizeSelectedVariantLabel(raw: unknown): string {
  return String(raw ?? '').trim();
}

export function customizationKeyFromSelections(
  complements: NormalizedLineComplementGroup[],
  supplements: NormalizedLineSupplement[],
  variantLabel?: string,
): string {
  const payload = canonicalizeCustomizationSelections(
    complements,
    supplements,
  );
  const variant = normalizeSelectedVariantLabel(variantLabel);
  const body = variant ? { ...payload, v: variant } : payload;
  return createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex')
    .slice(0, 32);
}

export function customizationSummaryLabel(
  complements: NormalizedLineComplementGroup[],
  supplements: NormalizedLineSupplement[],
  variantLabel?: string,
): string {
  const parts: string[] = [];
  const variant = normalizeSelectedVariantLabel(variantLabel);
  if (variant) parts.push(`Variante : ${variant}`);
  for (const g of complements) {
    for (const o of g.options) {
      parts.push(`${g.groupTitle}: ${o.label}`);
    }
  }
  for (const s of supplements) {
    parts.push(`+ ${s.name}`);
  }
  return parts.join(' · ').slice(0, 200);
}
