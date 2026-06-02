import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductDiscountScheduleDto } from '@modules/products/dto/products.dto';
import { ProductModel } from '@schemas/product.schema';
import { Model } from 'mongoose';

export type NormalizedDiscountSchedule = {
  label: string;
  startAt: Date;
  endAt: Date;
  price: number;
  discountPrice: number;
};

@Injectable()
export class ProductDiscountScheduleService {
  private readonly logger = new Logger(ProductDiscountScheduleService.name);

  constructor(
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
  ) {}

  normalizeSchedules(raw: unknown): NormalizedDiscountSchedule[] {
    if (!Array.isArray(raw)) return [];
    const out: NormalizedDiscountSchedule[] = [];
    for (const item of raw) {
      const row = (item ?? {}) as Record<string, unknown>;
      const startAt = this.parseDate(row.startAt ?? row.start_at);
      const endAt = this.parseDate(row.endAt ?? row.end_at);
      if (!startAt || !endAt) continue;
      if (endAt.getTime() <= startAt.getTime()) {
        throw new BadRequestException('invalid_discount_schedule_range');
      }
      const price = this.nonNegativeNumber(row.price);
      const discountPrice = this.nonNegativeNumber(
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

  normalizeSchedulesFromDto(
    rows: ProductDiscountScheduleDto[] | undefined,
  ): NormalizedDiscountSchedule[] {
    if (!rows?.length) return [];
    return this.normalizeSchedules(
      rows.map((r) => ({
        label: r.label,
        startAt: r.startAt,
        endAt: r.endAt,
        price: r.price,
        discountPrice: r.discountPrice ?? 0,
      })),
    );
  }

  schedulesForResponse(raw: unknown): Array<{
    label: string;
    startAt: string;
    endAt: string;
    price: number;
    discountPrice: number;
  }> {
    return this.normalizeSchedules(raw).map((s) => ({
      label: s.label,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      price: s.price,
      discountPrice: s.discountPrice,
    }));
  }

  pickActiveSchedule(
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

  /** Applique prix / promo actifs sur le document (sans sauvegarder). */
  applyToDocument(
    doc: ProductModel,
    now: Date = new Date(),
  ): boolean {
    const schedules = this.normalizeSchedules(doc.discountSchedules);
    const listPrice = this.resolveListPrice(doc);
    const listDiscountPrice = this.resolveListDiscountPrice(doc);
    const active = this.pickActiveSchedule(schedules, now);

    const nextPrice = active ? active.price : listPrice;
    const nextDiscount = active ? active.discountPrice : listDiscountPrice;

    const changed =
      doc.price !== nextPrice || (doc.discountPrice ?? 0) !== nextDiscount;
    doc.price = nextPrice;
    doc.discountPrice = nextDiscount;
    return changed;
  }

  resolveListPrice(doc: ProductModel): number {
    const raw = doc.listPrice;
    if (raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
      return Number(raw);
    }
    return Number(doc.price ?? 0);
  }

  resolveListDiscountPrice(doc: ProductModel): number {
    const raw = doc.listDiscountPrice;
    if (raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
      return Number(raw);
    }
    return Number(doc.discountPrice ?? 0);
  }

  async runPass(): Promise<{ scanned: number; updated: number }> {
    const docs = await this.productModel
      .find({
        discountSchedules: { $exists: true, $not: { $size: 0 } },
      })
      .select(
        'price discountPrice listPrice listDiscountPrice discountSchedules',
      )
      .exec();

    let updated = 0;
    for (const doc of docs) {
      try {
        if (this.applyToDocument(doc)) {
          await doc.save();
          updated += 1;
        }
      } catch (e) {
        this.logger.warn(
          `Discount schedule apply failed for product ${doc.id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return { scanned: docs.length, updated };
  }

  private parseDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    const s = String(value ?? '').trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private nonNegativeNumber(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException('invalid_discount_schedule_price');
    }
    return n;
  }
}
