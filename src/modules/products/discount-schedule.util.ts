import { BadRequestException } from '@nestjs/common';

/** Fenêtre promo normalisée (plats + boissons). */
export type NormalizedDiscountSchedule = {
  label: string;
  startAt: Date;
  endAt: Date;
  price: number;
  discountPrice: number;
};

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException('invalid_discount_schedule_price');
  }
  return n;
}

/**
 * Normalise un tableau brut de fenêtres promo.
 * Ignore les lignes sans dates ; refuse range/promo invalides.
 */
export function normalizeDiscountSchedules(
  raw: unknown,
): NormalizedDiscountSchedule[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedDiscountSchedule[] = [];
  for (const item of raw) {
    const row = (item ?? {}) as Record<string, unknown>;
    const startAt = parseDate(row.startAt ?? row.start_at);
    const endAt = parseDate(row.endAt ?? row.end_at);
    if (!startAt || !endAt) continue;
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException('invalid_discount_schedule_range');
    }
    const price = nonNegativeNumber(row.price);
    const discountPrice = nonNegativeNumber(
      row.discountPrice ?? row.discount_price ?? 0,
    );
    if (discountPrice > 0 && discountPrice >= price) {
      throw new BadRequestException('invalid_discount_schedule_promo');
    }
    const label = String(row.label ?? '').trim();
    out.push({
      label,
      startAt,
      endAt,
      price,
      discountPrice,
    });
  }
  out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return out;
}

/** Fenêtre active : startAt <= now < endAt ; si plusieurs, startAt le plus récent. */
export function pickActiveDiscountSchedule(
  schedules: NormalizedDiscountSchedule[],
  now: Date = new Date(),
): NormalizedDiscountSchedule | null {
  const t = now.getTime();
  const active = schedules.filter(
    (s) => s.startAt.getTime() <= t && t < s.endAt.getTime(),
  );
  if (!active.length) return null;
  return active.reduce((best, cur) =>
    cur.startAt.getTime() > best.startAt.getTime() ? cur : best,
  );
}

export function schedulesForDiscountResponse(raw: unknown): Array<{
  label: string;
  startAt: string;
  endAt: string;
  price: number;
  discountPrice: number;
}> {
  return normalizeDiscountSchedules(raw).map((s) => ({
    label: s.label,
    startAt: s.startAt.toISOString(),
    endAt: s.endAt.toISOString(),
    price: s.price,
    discountPrice: s.discountPrice,
  }));
}

/**
 * Prix effectifs selon fenêtre active ou baselines list*.
 * `priceKey` = 'price' (plats) ou 'priceCad' (boissons) côté caller.
 */
export function resolveEffectiveDiscountPricing(args: {
  listPrice: number;
  listDiscountPrice: number;
  schedulesRaw: unknown;
  now?: Date;
}): { price: number; discountPrice: number } {
  const schedules = normalizeDiscountSchedules(args.schedulesRaw);
  const active = pickActiveDiscountSchedule(schedules, args.now ?? new Date());
  if (active) {
    return { price: active.price, discountPrice: active.discountPrice };
  }
  return {
    price: args.listPrice,
    discountPrice: args.listDiscountPrice,
  };
}

/** Prix unitaire panier / affichage : promo si 0 < discount < price. */
export function resolvePromoUnitPrice(
  price: number,
  discountPrice: number | null | undefined,
): number {
  const p = Number(price) || 0;
  const d = Number(discountPrice ?? 0);
  if (d > 0 && d < p) return d;
  return p;
}
