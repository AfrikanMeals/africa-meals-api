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

export function customizationKeyFromSelections(
  complements: NormalizedLineComplementGroup[],
  supplements: NormalizedLineSupplement[],
): string {
  const payload = JSON.stringify({ c: complements, s: supplements });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function customizationSummaryLabel(
  complements: NormalizedLineComplementGroup[],
  supplements: NormalizedLineSupplement[],
): string {
  const parts: string[] = [];
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
