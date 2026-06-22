import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  StoreAdCashLedgerModel,
  StoreAdCashLedgerTypeEnum,
} from '@schemas/store-ad-cash.schema';
import { StoreModel } from '@schemas/store.schema';
import { Model, Types } from 'mongoose';

@Injectable()
export class StoreAdCashGrantService {
  constructor(
    @InjectModel(StoreAdCashLedgerModel.name)
    private readonly ledgerModel: Model<StoreAdCashLedgerModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    private readonly supportedCountries: SupportedCountriesService,
  ) {}

  async grantFromSubscriptionPlan(
    storeId: string,
    amount: number,
    note?: string,
  ): Promise<void> {
    await this._grant(storeId, amount, note?.trim() || null, null);
  }

  async grantByAdmin(
    storeId: string,
    amount: number,
    note: string | undefined,
    grantedBy: Types.ObjectId,
  ): Promise<{ balanceAdCash: number }> {
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException('invalid_store_id');
    }
    const units = Number(amount);
    if (!Number.isFinite(units) || units <= 0) {
      throw new BadRequestException('invalid_ad_cash_amount');
    }
    const balance = await this._grant(
      storeId,
      units,
      note?.trim() || null,
      grantedBy,
    );
    return { balanceAdCash: balance };
  }

  private async _grant(
    storeId: string,
    amount: number,
    note: string | null,
    grantedBy: Types.ObjectId | null,
  ): Promise<number> {
    if (!Types.ObjectId.isValid(storeId)) return 0;
    const units = Number(amount);
    if (!Number.isFinite(units) || units <= 0) return 0;

    const store = await this.storeModel
      .findById(storeId)
      .select('owner name region currency')
      .lean()
      .exec();
    if (!store?.owner) {
      if (grantedBy) throw new NotFoundException('store_not_found');
      return 0;
    }

    const ctx = await this._resolveContext(storeId, store);
    if (!ctx) {
      if (grantedBy) throw new NotFoundException('store_not_found');
      return 0;
    }

    const currencyEquivalent = Number((units * ctx.exchangeRate).toFixed(2));
    await this.ledgerModel.create({
      store: ctx.storeOid,
      owner: store.owner,
      type: StoreAdCashLedgerTypeEnum.GRANT,
      adCashAmount: Number(units.toFixed(4)),
      currencyEquivalent,
      exchangeRate: ctx.exchangeRate,
      currency: ctx.currency,
      grantedBy,
      note,
    });

    return this._balanceUnits(storeId);
  }

  private async _resolveContext(
    storeId: string,
    store: { region?: string; currency?: string },
  ): Promise<{
    storeOid: Types.ObjectId;
    regionCode: string;
    currency: string;
    exchangeRate: number;
  } | null> {
    const regionCode = String(store.region ?? 'CA')
      .trim()
      .toUpperCase();
    const exchangeRate =
      await this.supportedCountries.getAdCashToCurrencyRate(regionCode);
    const currency =
      (await this.supportedCountries.getCountryCurrency(regionCode)) ||
      String(store.currency ?? 'CAD').toUpperCase();
    return {
      storeOid: new Types.ObjectId(storeId),
      regionCode,
      currency,
      exchangeRate,
    };
  }

  private async _balanceUnits(storeId: string): Promise<number> {
    const storeOid = new Types.ObjectId(storeId);
    const [grants, redemptions] = await Promise.all([
      this.ledgerModel
        .aggregate<{ total: number }>([
          {
            $match: {
              store: storeOid,
              type: StoreAdCashLedgerTypeEnum.GRANT,
            },
          },
          { $group: { _id: null, total: { $sum: '$adCashAmount' } } },
        ])
        .exec(),
      this.ledgerModel
        .aggregate<{ total: number }>([
          {
            $match: {
              store: storeOid,
              type: StoreAdCashLedgerTypeEnum.REDEMPTION,
            },
          },
          { $group: { _id: null, total: { $sum: '$adCashAmount' } } },
        ])
        .exec(),
    ]);
    const granted = Number(grants[0]?.total ?? 0);
    const redeemed = Number(redemptions[0]?.total ?? 0);
    return Math.max(0, Number((granted - redeemed).toFixed(4)));
  }
}
