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
    // Catalogue / payloads partiels : `title` au lieu de groupTitle.
    const groupTitle = String(
      row.groupTitle ?? row.group_title ?? row.title ?? '',
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

/** Total vendeur des options sélectionnées (priceDelta + prix suppléments). */
export function sumSelectedCustomizationVendorExtras(
  complements: NormalizedLineComplementGroup[],
  supplements: NormalizedLineSupplement[],
): number {
  let total = 0;
  for (const g of complements) {
    for (const o of g.options) {
      const d = Number(o.priceDelta ?? 0);
      if (Number.isFinite(d) && d > 0) total += d;
    }
  }
  for (const s of supplements) {
    const p = Number(s.price ?? 0);
    if (Number.isFinite(p) && p > 0) total += p;
  }
  return total;
}

/**
 * Recalcule les priceDelta / prix depuis la fiche produit (source de vérité),
 * y compris `firstOptionFree` sur les groupes de compléments.
 */
export function repriceCustomizationFromProductCatalog(
  product: {
    complements?: unknown;
    supplements?: unknown;
  },
  selectedComplements: NormalizedLineComplementGroup[],
  selectedSupplements: NormalizedLineSupplement[],
): {
  complements: NormalizedLineComplementGroup[];
  supplements: NormalizedLineSupplement[];
} {
  const catalogGroups = Array.isArray(product.complements)
    ? product.complements
    : [];
  const catalogSupplements = Array.isArray(product.supplements)
    ? product.supplements
    : [];

  const complements: NormalizedLineComplementGroup[] = selectedComplements.map(
    (g) => {
      const catalog = catalogGroups.find((cg) => {
        const row = (cg ?? {}) as Record<string, unknown>;
        return (
          String(row.title ?? '').trim().toLowerCase() ===
          g.groupTitle.trim().toLowerCase()
        );
      }) as Record<string, unknown> | undefined;
      const firstOptionFree = Boolean(
        catalog?.firstOptionFree ?? catalog?.first_option_free ?? false,
      );
      const catalogOptions = Array.isArray(catalog?.options)
        ? catalog.options
        : [];
      const options = g.options.map((o) => {
        const catOptIndex = catalogOptions.findIndex((co) => {
          const row = (co ?? {}) as Record<string, unknown>;
          return (
            String(row.label ?? '').trim().toLowerCase() ===
            o.label.trim().toLowerCase()
          );
        });
        const catOpt =
          catOptIndex >= 0
            ? (catalogOptions[catOptIndex] as Record<string, unknown>)
            : undefined;
        let priceDelta = Number(
          catOpt?.priceDelta ?? catOpt?.price_delta ?? o.priceDelta ?? 0,
        );
        if (!Number.isFinite(priceDelta) || priceDelta < 0) priceDelta = 0;
        // Première option du groupe catalogue offerte.
        if (firstOptionFree && catOptIndex === 0) priceDelta = 0;
        return { label: o.label, priceDelta };
      });
      return { groupTitle: g.groupTitle, options };
    },
  );

  const supplements: NormalizedLineSupplement[] = selectedSupplements.map(
    (s) => {
      const cat = catalogSupplements.find((cs) => {
        const row = (cs ?? {}) as Record<string, unknown>;
        return (
          String(row.name ?? '').trim().toLowerCase() ===
          s.name.trim().toLowerCase()
        );
      }) as Record<string, unknown> | undefined;
      let price = Number(cat?.price ?? s.price ?? 0);
      if (!Number.isFinite(price) || price < 0) price = 0;
      return { name: s.name, price };
    },
  );

  return { complements, supplements };
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
