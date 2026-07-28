import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PlatformFeesService } from '@modules/platform-fees/platform-fees.service';
import {
  AdCreditPaymentModel,
  AdCreditPaymentStatusEnum,
} from '@schemas/ad-credit-payment.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import {
  PartnerSubscriptionModel,
} from '@schemas/partner-subscription.schema';
import {
  PartnerSubscriptionPlanModel,
} from '@schemas/partner-subscription-plan.schema';
import {
  SubscriptionPlanModel,
} from '@schemas/subscription-plan.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import {
  VendorNotificationChargeStatusEnum,
  VendorNotificationMonthlyChargeModel,
} from '@schemas/vendor-notification-monthly-charge.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import { Model } from 'mongoose';
/** dayjs CJS — même pattern que dashboard.service. */
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');
import {
  convertMajorToCad,
  fetchCadFxRates,
  normalizeFxCurrency,
  sumCentsByCurrencyToCad,
  type CadFxRates,
} from './gain-estimate-cad-fx.util';
import { buildGainEstimateFromRaw, roundCad } from './gain-estimate-build.util';
import { GainEstimateLlmService } from './gain-estimate-llm.service';
import {
  gainEstimatePeriodDays,
  parseGainEstimatePeriod,
} from './gain-estimate-period.util';
import type {
  GainEstimateFeeConfigSnapshot,
  GainEstimatePayload,
  GainEstimatePeriodKey,
  GainEstimatePlanSnapshot,
} from './gain-estimate.types';

dayjs.extend(utc);
dayjs.extend(timezone);

const GAIN_ESTIMATE_TZ = 'America/Toronto';

const ORDER_STATUSES_FOR_FEES: OrderStatusEnum[] = [
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.COMPLETED,
];

@Injectable()
export class GainEstimateService {
  constructor(
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(AdCreditPaymentModel.name)
    private readonly adCreditPaymentModel: Model<AdCreditPaymentModel>,
    @InjectModel(VendorNotificationMonthlyChargeModel.name)
    private readonly smsChargeModel: Model<VendorNotificationMonthlyChargeModel>,
    @InjectModel(VendorSubscriptionModel.name)
    private readonly vendorSubModel: Model<VendorSubscriptionModel>,
    @InjectModel(PartnerSubscriptionModel.name)
    private readonly partnerSubModel: Model<PartnerSubscriptionModel>,
    @InjectModel(SubscriptionPlanModel.name)
    private readonly vendorPlanModel: Model<SubscriptionPlanModel>,
    @InjectModel(PartnerSubscriptionPlanModel.name)
    private readonly partnerPlanModel: Model<PartnerSubscriptionPlanModel>,
    private readonly platformFees: PlatformFeesService,
    private readonly llm: GainEstimateLlmService,
  ) {}

  /**
   * P&L plateforme admin : agrégats + résumé IA (LLM ou heuristique).
   */
  async getGainEstimate(
    user: UserModel,
    periodRaw?: string,
    localeRaw?: string,
  ): Promise<GainEstimatePayload> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }

    const period = parseGainEstimatePeriod(periodRaw);
    const locale = localeRaw === 'en' ? 'en' : 'fr';
    const days = gainEstimatePeriodDays(period);
    const z = GAIN_ESTIMATE_TZ;
    const now = dayjs().tz(z);
    const start = now.subtract(days - 1, 'day').startOf('day').toDate();
    const endExclusive = now.add(1, 'day').startOf('day').toDate();
    const from = dayjs(start).tz(z).format('YYYY-MM-DD');
    const to = now.format('YYYY-MM-DD');

    // Taux CAD (best-effort) — sans taux, devises hors CAD → unconverted.
    const rates = await fetchCadFxRates();

    const [
      orderFeeAgg,
      adCreditCad,
      smsPaidCad,
      smsPendingCad,
      vendorSubs,
      partnerSubs,
      planSnapshot,
      feeConfigSnapshot,
    ] = await Promise.all([
      this.aggregateOrderFeesByCurrency(start, endExclusive),
      this.sumAdCreditCad(start, endExclusive),
      this.sumSmsCad(start, endExclusive, 'paid'),
      this.sumSmsDueCad(),
      this.sumSubscriptionsCad(this.vendorSubModel, start, endExclusive, rates),
      this.sumSubscriptionsCad(this.partnerSubModel, start, endExclusive, rates),
      this.buildPlanSnapshot(rates),
      this.buildFeeConfigSnapshot(),
    ]);

    const commission = sumCentsByCurrencyToCad(
      orderFeeAgg.map((r) => ({
        currency: r.currency,
        amountCents: r.platformFeeCents,
      })),
      rates,
      'order_commission',
    );
    const paymentFees = sumCentsByCurrencyToCad(
      orderFeeAgg.map((r) => ({
        currency: r.currency,
        amountCents: r.orderPaymentFeeCents,
      })),
      rates,
      'order_payment_fee',
    );
    const stripeCost = sumCentsByCurrencyToCad(
      orderFeeAgg.map((r) => ({
        currency: r.currency,
        amountCents: r.stripeProcessingFeeCents,
      })),
      rates,
      'stripe_processing',
    );

    // Payout fees : estimation barème × volume transfers (pas de ledger Mongo).
    const transferGrossCentsCad = sumCentsByCurrencyToCad(
      orderFeeAgg.map((r) => ({
        currency: r.currency,
        amountCents: r.transferAmountCents,
      })),
      rates,
      'payout_base',
    );
    const payoutFeesCad = this.estimatePayoutFeesCad(
      transferGrossCentsCad.cad,
      feeConfigSnapshot,
    );

    const unconverted = [
      ...commission.unconverted,
      ...paymentFees.unconverted,
      ...stripeCost.unconverted,
      ...vendorSubs.unconverted,
      ...partnerSubs.unconverted,
      ...transferGrossCentsCad.unconverted,
    ];

    const base = buildGainEstimateFromRaw(
      {
        orderCommissionCad: commission.cad,
        orderPaymentFeeCad: paymentFees.cad,
        vendorSubscriptionsCad: vendorSubs.cad,
        partnerSubscriptionsCad: partnerSubs.cad,
        adCreditCad,
        smsPaidCad,
        smsPendingCad,
        payoutFeesCad,
        payoutFeesEstimated: true,
        stripeProcessingCad: stripeCost.cad,
        planSnapshot,
        feeConfigSnapshot,
        locale,
      },
      {
        periodKey: period,
        from,
        to,
        timezone: z,
        unconverted,
      },
    );

    const ai = await this.llm.analyze(base, locale);
    return { ...base, ai };
  }

  private estimatePayoutFeesCad(
    transferGrossCad: number,
    fee: GainEstimateFeeConfigSnapshot,
  ): number {
    const grossCents = Math.round(Math.max(0, transferGrossCad) * 100);
    if (grossCents <= 0) return 0;
    if (fee.payoutFeeMode === 'percent') {
      return roundCad((grossCents * Math.max(0, fee.payoutFeePercent)) / 10000);
    }
    // fixed : approximer 1 versement / période absurde — on applique % 0 + fixed * 0
    // pour fixed seul sans count payouts : proportionnel faible = 0 si fixed-only sans volume count.
    // Meilleure approx v1 : appliquer fixed comme si 1 payout sur le gros, sinon percent.
    if (fee.payoutFeeFixed > 0 && fee.payoutFeePercent <= 0) {
      // Sans compteur de payouts, on estime 0 (évite sur-estimer) — signalé estimated.
      return 0;
    }
    return roundCad((grossCents * Math.max(0, fee.payoutFeePercent)) / 10000);
  }

  private async aggregateOrderFeesByCurrency(
    start: Date,
    endExclusive: Date,
  ): Promise<
    Array<{
      currency: string;
      platformFeeCents: number;
      orderPaymentFeeCents: number;
      stripeProcessingFeeCents: number;
      transferAmountCents: number;
    }>
  > {
    const rows = await this.orderModel.aggregate<{
      _id: string;
      platformFeeCents: number;
      orderPaymentFeeCents: number;
      stripeProcessingFeeCents: number;
      transferAmountCents: number;
    }>([
      {
        $match: {
          createdAt: { $gte: start, $lt: endExclusive },
          status: { $in: ORDER_STATUSES_FOR_FEES },
        },
      },
      {
        $group: {
          _id: {
            $toUpper: { $ifNull: ['$currency', 'CAD'] },
          },
          platformFeeCents: {
            $sum: {
              $ifNull: [
                '$platformFeeCents',
                { $ifNull: ['$platform_fee_cents', 0] },
              ],
            },
          },
          orderPaymentFeeCents: {
            $sum: {
              $ifNull: [
                '$orderPaymentFeeCents',
                { $ifNull: ['$order_payment_fee_cents', 0] },
              ],
            },
          },
          stripeProcessingFeeCents: {
            $sum: {
              $ifNull: [
                '$stripeProcessingFeeCents',
                { $ifNull: ['$stripe_processing_fee_cents', 0] },
              ],
            },
          },
          transferAmountCents: {
            $sum: {
              $ifNull: [
                '$stripeTransferAmountCents',
                { $ifNull: ['$stripe_transfer_amount_cents', 0] },
              ],
            },
          },
        },
      },
    ]);

    return rows.map((r) => ({
      currency: normalizeFxCurrency(r._id) || 'CAD',
      platformFeeCents: Math.max(0, Math.round(r.platformFeeCents || 0)),
      orderPaymentFeeCents: Math.max(0, Math.round(r.orderPaymentFeeCents || 0)),
      stripeProcessingFeeCents: Math.max(
        0,
        Math.round(r.stripeProcessingFeeCents || 0),
      ),
      transferAmountCents: Math.max(0, Math.round(r.transferAmountCents || 0)),
    }));
  }

  private async sumAdCreditCad(start: Date, endExclusive: Date): Promise<number> {
    const rows = await this.adCreditPaymentModel.aggregate<{ total: number }>([
      {
        $match: {
          status: AdCreditPaymentStatusEnum.PAID,
          paidAt: { $gte: start, $lt: endExclusive },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$amountPaidCad', 0] } },
        },
      },
    ]);
    return roundCad(Number(rows[0]?.total ?? 0));
  }

  private async sumSmsCad(
    start: Date,
    endExclusive: Date,
    mode: 'paid',
  ): Promise<number> {
    void mode;
    const rows = await this.smsChargeModel.aggregate<{ total: number }>([
      {
        $match: {
          status: VendorNotificationChargeStatusEnum.PAID,
          paidAt: { $gte: start, $lt: endExclusive },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$smsTotalCad', 0] } },
        },
      },
    ]);
    return roundCad(Number(rows[0]?.total ?? 0));
  }

  /** SMS dues / pending (revenu potentiel plateforme). */
  private async sumSmsDueCad(): Promise<number> {
    const rows = await this.smsChargeModel.aggregate<{ total: number }>([
      {
        $match: {
          status: {
            $in: [
              VendorNotificationChargeStatusEnum.PENDING,
              VendorNotificationChargeStatusEnum.INVOICED,
              VendorNotificationChargeStatusEnum.OVERDUE,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$smsTotalCad', 0] } },
        },
      },
    ]);
    return roundCad(Number(rows[0]?.total ?? 0));
  }

  private async sumSubscriptionsCad(
    model: Model<VendorSubscriptionModel> | Model<PartnerSubscriptionModel>,
    start: Date,
    endExclusive: Date,
    rates: CadFxRates | null,
  ): Promise<{
    cad: number;
    unconverted: Array<{ currency: string; amountMajor: number; source: string }>;
  }> {
    const rows = await model.aggregate<{
      _id: string;
      total: number;
      count: number;
    }>([
      {
        $match: {
          createdAt: { $gte: start, $lt: endExclusive },
          status: { $in: ['ACTIVE', 'EXPIRED', 'CANCELLED'] },
          pricePaid: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: { $toUpper: { $ifNull: ['$currency', 'CAD'] } },
          total: { $sum: { $ifNull: ['$pricePaid', 0] } },
          count: { $sum: 1 },
        },
      },
    ]);

    let cad = 0;
    const unconverted: Array<{
      currency: string;
      amountMajor: number;
      source: string;
    }> = [];
    for (const row of rows) {
      const amount = Number(row.total ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const converted = convertMajorToCad(amount, row._id, rates);
      if (converted == null) {
        unconverted.push({
          currency: normalizeFxCurrency(row._id) || 'UNK',
          amountMajor: amount,
          source: 'subscriptions',
        });
        continue;
      }
      cad += converted;
    }
    return { cad: roundCad(cad), unconverted };
  }

  private async buildPlanSnapshot(
    rates: CadFxRates | null,
  ): Promise<GainEstimatePlanSnapshot> {
    const [vendorActive, partnerActive, vendorAvg, partnerAvg, vendorCatalog, partnerCatalog] =
      await Promise.all([
        this.vendorSubModel.countDocuments({ status: 'ACTIVE' }),
        this.partnerSubModel.countDocuments({ status: 'ACTIVE' }),
        this.avgActivePricePaidCad(this.vendorSubModel, rates),
        this.avgActivePricePaidCad(this.partnerSubModel, rates),
        this.avgCatalogMonthlyCad(this.vendorPlanModel, rates),
        this.avgCatalogMonthlyCad(this.partnerPlanModel, rates),
      ]);

    return {
      vendorActiveCount: vendorActive,
      partnerActiveCount: partnerActive,
      vendorAvgPricePaidCad: vendorAvg,
      partnerAvgPricePaidCad: partnerAvg,
      vendorCatalogAvgMonthlyCad: vendorCatalog,
      partnerCatalogAvgMonthlyCad: partnerCatalog,
    };
  }

  private async avgActivePricePaidCad(
    model: Model<VendorSubscriptionModel> | Model<PartnerSubscriptionModel>,
    rates: CadFxRates | null,
  ): Promise<number> {
    // Union Model<> : TS ne résout pas .find — passer par Model générique.
    const rows = await (model as Model<{ pricePaid: number; currency?: string }>)
      .find({ status: 'ACTIVE', pricePaid: { $gt: 0 } })
      .select('pricePaid currency')
      .lean()
      .exec();
    if (!rows.length) return 0;
    let sum = 0;
    let n = 0;
    for (const row of rows) {
      const converted = convertMajorToCad(
        Number(row.pricePaid ?? 0),
        row.currency,
        rates,
      );
      if (converted == null) continue;
      sum += converted;
      n += 1;
    }
    return n ? roundCad(sum / n) : 0;
  }

  private async avgCatalogMonthlyCad(
    model: Model<SubscriptionPlanModel> | Model<PartnerSubscriptionPlanModel>,
    rates: CadFxRates | null,
  ): Promise<number> {
    // Union Model<> : même contournement pour .find catalogue.
    const rows = await (model as Model<{
      priceMonthly: number;
      currency?: string;
      active?: boolean;
    }>)
      .find({ active: true, priceMonthly: { $gt: 0 } })
      .select('priceMonthly currency')
      .lean()
      .exec();
    if (!rows.length) {
      // Partner plans peuvent utiliser un autre champ — repli priceMonthly only.
      return 0;
    }
    let sum = 0;
    let n = 0;
    for (const row of rows) {
      const converted = convertMajorToCad(
        Number(row.priceMonthly ?? 0),
        row.currency,
        rates,
      );
      if (converted == null) continue;
      sum += converted;
      n += 1;
    }
    return n ? roundCad(sum / n) : 0;
  }

  private async buildFeeConfigSnapshot(): Promise<GainEstimateFeeConfigSnapshot> {
    const [commission, payout, checkout] = await Promise.all([
      this.platformFees.getGlobalOrderCommissionSettings(),
      this.platformFees.getGlobalPayoutFeeSettings(),
      this.platformFees.getPublicCheckoutFees(),
    ]);
    return {
      orderCommissionMode: commission.platformOrderFeeMode,
      orderCommissionFixed: commission.platformOrderFeeFixed,
      orderCommissionPercent: commission.platformOrderFeePercent,
      orderPaymentFeeMode: checkout.orderPaymentFeeMode,
      orderPaymentFeeFixed: checkout.orderPaymentFeeFixed,
      orderPaymentFeePercent: checkout.orderPaymentFeePercent,
      payoutFeeMode: payout.payoutFeeMode,
      payoutFeeFixed: payout.payoutFeeFixed,
      payoutFeePercent: payout.payoutFeePercent,
    };
  }
}

/** Exposé pour tests de période. */
export function gainEstimatePeriodWindow(
  period: GainEstimatePeriodKey,
  now = dayjs().tz(GAIN_ESTIMATE_TZ),
): { start: Date; endExclusive: Date; from: string; to: string } {
  const days = gainEstimatePeriodDays(period);
  const start = now.subtract(days - 1, 'day').startOf('day').toDate();
  const endExclusive = now.add(1, 'day').startOf('day').toDate();
  return {
    start,
    endExclusive,
    from: dayjs(start).tz(GAIN_ESTIMATE_TZ).format('YYYY-MM-DD'),
    to: now.format('YYYY-MM-DD'),
  };
}
