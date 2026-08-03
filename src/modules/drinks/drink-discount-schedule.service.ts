import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductDiscountScheduleDto } from '@modules/products/dto/products.dto';
import {
  NormalizedDiscountSchedule,
  normalizeDiscountSchedules,
  pickActiveDiscountSchedule,
  resolveEffectiveDiscountPricing,
  schedulesForDiscountResponse,
} from '@modules/products/discount-schedule.util';
import { DrinkModel } from '@schemas/drink.schema';
import { Model } from 'mongoose';

/**
 * Fenêtres promo boissons : mutent `priceCad` / `discountPrice`
 * (équivalent Food `price` / `discountPrice`).
 */
@Injectable()
export class DrinkDiscountScheduleService {
  private readonly logger = new Logger(DrinkDiscountScheduleService.name);

  constructor(
    @InjectModel(DrinkModel.name)
    private readonly drinkModel: Model<DrinkModel>,
  ) {}

  normalizeSchedules(raw: unknown): NormalizedDiscountSchedule[] {
    return normalizeDiscountSchedules(raw);
  }

  normalizeSchedulesFromDto(
    rows: ProductDiscountScheduleDto[] | undefined,
  ): NormalizedDiscountSchedule[] {
    if (!rows?.length) return [];
    return normalizeDiscountSchedules(
      rows.map((r) => ({
        label: r.label,
        startAt: r.startAt,
        endAt: r.endAt,
        price: r.price,
        discountPrice: r.discountPrice ?? 0,
      })),
    );
  }

  schedulesForResponse(raw: unknown) {
    return schedulesForDiscountResponse(raw);
  }

  pickActiveSchedule(
    schedules: NormalizedDiscountSchedule[],
    now: Date = new Date(),
  ): NormalizedDiscountSchedule | null {
    return pickActiveDiscountSchedule(schedules, now);
  }

  resolveListPrice(doc: DrinkModel): number {
    const raw = doc.listPrice;
    if (raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
      return Number(raw);
    }
    return Number(doc.priceCad ?? 0);
  }

  resolveListDiscountPrice(doc: DrinkModel): number {
    const raw = doc.listDiscountPrice;
    if (raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
      return Number(raw);
    }
    return Number(doc.discountPrice ?? 0);
  }

  /** Applique prix / promo actifs sur `priceCad` (sans sauvegarder). */
  applyToDocument(doc: DrinkModel, now: Date = new Date()): boolean {
    const next = resolveEffectiveDiscountPricing({
      listPrice: this.resolveListPrice(doc),
      listDiscountPrice: this.resolveListDiscountPrice(doc),
      schedulesRaw: doc.discountSchedules,
      now,
    });
    const changed =
      Number(doc.priceCad) !== next.price ||
      Number(doc.discountPrice ?? 0) !== next.discountPrice;
    doc.priceCad = next.price;
    doc.discountPrice = next.discountPrice;
    return changed;
  }

  async runPass(): Promise<{ scanned: number; updated: number }> {
    const docs = await this.drinkModel
      .find({
        discountSchedules: { $exists: true, $not: { $size: 0 } },
      })
      .select(
        'priceCad discountPrice listPrice listDiscountPrice discountSchedules',
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
          `Discount schedule apply failed for drink ${doc.id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return { scanned: docs.length, updated };
  }
}
