import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DashboardService } from '@modules/dashboard/dashboard.service';
import type { OpsReportPeriodBounds } from '@modules/admin-ops-reports/admin-ops-report-period.util';
import type { VendorOpsReportRecipient } from '@modules/admin-ops-reports/vendor-ops-report-recipients.util';
import {
  buildOpsReportWorkbook,
  type OpsReportSheet,
} from '@modules/admin-ops-reports/admin-ops-report-excel.util';
import { AdModel } from '@schemas/ad.schema';
import {
  AdCampaignEventModel,
  AdCampaignEventTypeEnum,
} from '@schemas/ad-campaign-event.schema';
import { AdCampaignModel } from '@schemas/ad-campaign.schema';
import { AdEventModel, AdEventTypeEnum } from '@schemas/ad-event.schema';
import { AdNotificationEventModel } from '@schemas/ad-notification-event.schema';
import { UserModel } from '@schemas/user.schema';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Model, Types } from 'mongoose';

dayjs.extend(utc);
dayjs.extend(timezone);

export type VendorOpsReportBuildResult = {
  bounds: OpsReportPeriodBounds;
  sheets: OpsReportSheet[];
  workbook: Buffer;
  htmlSummary: string;
  filename: string;
};

@Injectable()
export class AdminOpsReportBuilderService {
  constructor(
    private readonly dashboard: DashboardService,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(AdModel.name)
    private readonly adModel: Model<AdModel>,
    @InjectModel(AdCampaignModel.name)
    private readonly adCampaignModel: Model<AdCampaignModel>,
    @InjectModel(AdEventModel.name)
    private readonly adEventModel: Model<AdEventModel>,
    @InjectModel(AdCampaignEventModel.name)
    private readonly adCampaignEventModel: Model<AdCampaignEventModel>,
    @InjectModel(AdNotificationEventModel.name)
    private readonly adNotificationEventModel: Model<AdNotificationEventModel>,
  ) {}

  async buildForVendor(
    recipient: VendorOpsReportRecipient,
    bounds: OpsReportPeriodBounds,
  ): Promise<VendorOpsReportBuildResult> {
    const z = bounds.timezone;
    const start = dayjs.tz(bounds.from, z).startOf('day').toDate();
    const endExclusive = dayjs.tz(bounds.to, z).add(1, 'day').startOf('day').toDate();
    const storeIds = recipient.storeIds;

    const vendorUser = await this.userModel.findById(recipient.ownerId).exec();
    if (!vendorUser) {
      throw new Error('vendor_owner_not_found');
    }

    const [adIds, campaignIds] = await Promise.all([
      this.adModel.distinct('_id', { store: { $in: storeIds } }).exec(),
      this.adCampaignModel.distinct('_id', { store: { $in: storeIds } }).exec(),
    ]);

    const [
      finance,
      bannerAgg,
      campaignAgg,
      notificationAgg,
    ] = await Promise.all([
      this.dashboard.getFinancePeriodReport(
        vendorUser,
        bounds.from,
        bounds.to,
      ),
      this.aggregateAdEvents(start, endExclusive, adIds as Types.ObjectId[]),
      this.aggregateCampaignEvents(
        start,
        endExclusive,
        campaignIds as Types.ObjectId[],
      ),
      this.aggregateNotificationEvents(start, endExclusive, storeIds),
    ]);

    const s = finance.summary;
    const periodLabel = bounds.labelFr;
    const storesLabel = recipient.storeNames.join(', ');

    const resumeSheet: OpsReportSheet = {
      name: 'Résumé',
      headers: ['Indicateur', 'Valeur'],
      rows: [
        ['Période', periodLabel],
        ['Du', bounds.from],
        ['Au', bounds.to],
        ['Fuseau', z],
        ['Propriétaire', recipient.fullName],
        ['Boutique(s)', storesLabel],
        ['Commandes (payées)', s.orderCount],
        ['CA total', s.totalRevenue],
        ['Panier moyen', s.avgOrderValue],
        ['Livraison', s.shippingTotal],
        ['Tendance CA %', s.trendPercent ?? '—'],
        ['Crédit pub payé', s.adCredit?.paidTotal ?? 0],
        ['Paiements crédit pub', s.adCredit?.paymentCount ?? 0],
        ['Impressions bannières', bannerAgg.impressions],
        ['Clics bannières', bannerAgg.clicks],
        ['Conversions bannières', bannerAgg.conversions],
        ['Impressions campagnes', campaignAgg.impressions],
        ['Clics campagnes', campaignAgg.clicks],
        ['Conversions campagnes', campaignAgg.conversions],
        ['Livraisons notifications', notificationAgg.deliveries],
        ['Interactions notifications', notificationAgg.interactions],
        ['Conversions notifications', notificationAgg.conversions],
      ],
    };

    const ordersSheet: OpsReportSheet = {
      name: 'Commandes',
      headers: [
        'N°',
        'Date',
        'Client',
        'E-mail',
        'Boutique',
        'Total',
        'Livraison',
        'Statut',
        'Devise',
      ],
      rows: finance.orders.map((o) => [
        o.orderNumber,
        o.createdAt,
        o.customerName,
        o.customerEmail,
        o.storeName ?? '—',
        o.totalPrice,
        o.shippingPrice,
        o.status,
        o.currency ?? 'CAD',
      ]),
    };

    const financeDailySheet: OpsReportSheet = {
      name: 'Finance',
      headers: ['Date', 'Commandes', 'CA', 'Devise'],
      rows: finance.daily.map((d) => [
        d.date,
        d.orderCount,
        d.revenue,
        d.currency ?? 'CAD',
      ]),
    };

    const bannersSheet: OpsReportSheet = {
      name: 'Bannières',
      headers: ['Bannière ID', 'Impressions', 'Clics', 'Conversions'],
      rows: bannerAgg.byEntity.map((r) => [
        r.entityId,
        r.impressions,
        r.clicks,
        r.conversions,
      ]),
    };

    const campaignsSheet: OpsReportSheet = {
      name: 'Campagnes',
      headers: ['Campagne ID', 'Impressions', 'Clics', 'Conversions'],
      rows: campaignAgg.byEntity.map((r) => [
        r.entityId,
        r.impressions,
        r.clicks,
        r.conversions,
      ]),
    };

    const notificationsSheet: OpsReportSheet = {
      name: 'Notifications',
      headers: ['Canal', 'Livraisons', 'Interactions', 'Conversions'],
      rows: notificationAgg.byChannel.map((r) => [
        r.channel,
        r.deliveries,
        r.interactions,
        r.conversions,
      ]),
    };

    const sheets = [
      resumeSheet,
      ordersSheet,
      financeDailySheet,
      bannersSheet,
      campaignsSheet,
      notificationsSheet,
    ];

    const workbook = await buildOpsReportWorkbook(sheets);
    const safePeriod = bounds.periodKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `rapport-boutique_${safePeriod}.xlsx`;

    const htmlSummary = `
      <h2>Votre rapport d'activité — ${periodLabel}</h2>
      <p><strong>Bonjour ${recipient.fullName},</strong></p>
      <p><strong>Période :</strong> ${bounds.from} → ${bounds.to} (${z})</p>
      <p><strong>Boutique(s) :</strong> ${storesLabel}</p>
      <ul>
        <li>Commandes : <strong>${s.orderCount}</strong> — CA <strong>${s.totalRevenue}</strong></li>
        <li>Publicités : ${bannerAgg.impressions + campaignAgg.impressions} impressions, ${bannerAgg.clicks + campaignAgg.clicks} clics</li>
        <li>Notifications : ${notificationAgg.deliveries} livraisons</li>
      </ul>
      <p>Le fichier Excel joint détaille vos commandes, finances et campagnes (${sheets.length} onglets).</p>
    `.trim();

    return {
      bounds,
      sheets,
      workbook,
      htmlSummary,
      filename,
    };
  }

  private async aggregateAdEvents(
    start: Date,
    endExclusive: Date,
    adIds: Types.ObjectId[],
  ) {
    if (!adIds.length) {
      return {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        byEntity: [] as Array<{
          entityId: string;
          impressions: number;
          clicks: number;
          conversions: number;
        }>,
      };
    }
    const rows = await this.adEventModel
      .aggregate<{
        _id: Types.ObjectId;
        impressions: number;
        clicks: number;
        conversions: number;
      }>([
        {
          $match: {
            ad: { $in: adIds },
            createdAt: { $gte: start, $lt: endExclusive },
          },
        },
        {
          $group: {
            _id: '$ad',
            impressions: {
              $sum: {
                $cond: [
                  { $eq: ['$eventType', AdEventTypeEnum.IMPRESSION] },
                  1,
                  0,
                ],
              },
            },
            clicks: {
              $sum: {
                $cond: [{ $eq: ['$eventType', AdEventTypeEnum.CLICK] }, 1, 0],
              },
            },
            conversions: {
              $sum: {
                $cond: [
                  { $eq: ['$eventType', AdEventTypeEnum.CONVERSION] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { conversions: -1, clicks: -1, impressions: -1 } },
        { $limit: 200 },
      ])
      .exec();

    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    const byEntity = rows.map((r) => {
      impressions += r.impressions;
      clicks += r.clicks;
      conversions += r.conversions;
      return {
        entityId: String(r._id ?? ''),
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
      };
    });
    return { impressions, clicks, conversions, byEntity };
  }

  private async aggregateCampaignEvents(
    start: Date,
    endExclusive: Date,
    campaignIds: Types.ObjectId[],
  ) {
    if (!campaignIds.length) {
      return {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        byEntity: [] as Array<{
          entityId: string;
          impressions: number;
          clicks: number;
          conversions: number;
        }>,
      };
    }
    const rows = await this.adCampaignEventModel
      .aggregate<{
        _id: Types.ObjectId;
        impressions: number;
        clicks: number;
        conversions: number;
      }>([
        {
          $match: {
            campaign: { $in: campaignIds },
            createdAt: { $gte: start, $lt: endExclusive },
          },
        },
        {
          $group: {
            _id: '$campaign',
            impressions: {
              $sum: {
                $cond: [
                  { $eq: ['$eventType', AdCampaignEventTypeEnum.IMPRESSION] },
                  1,
                  0,
                ],
              },
            },
            clicks: {
              $sum: {
                $cond: [
                  { $eq: ['$eventType', AdCampaignEventTypeEnum.CLICK] },
                  1,
                  0,
                ],
              },
            },
            conversions: {
              $sum: {
                $cond: [
                  { $eq: ['$eventType', AdCampaignEventTypeEnum.CONVERSION] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { conversions: -1, clicks: -1, impressions: -1 } },
        { $limit: 200 },
      ])
      .exec();

    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    const byEntity = rows.map((r) => {
      impressions += r.impressions;
      clicks += r.clicks;
      conversions += r.conversions;
      return {
        entityId: String(r._id ?? ''),
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
      };
    });
    return { impressions, clicks, conversions, byEntity };
  }

  private async aggregateNotificationEvents(
    start: Date,
    endExclusive: Date,
    storeIds: Types.ObjectId[],
  ) {
    const rows = await this.adNotificationEventModel
      .aggregate<{
        _id: string;
        deliveries: number;
        interactions: number;
        conversions: number;
      }>([
        {
          $match: {
            store: { $in: storeIds },
            deliveredAt: { $gte: start, $lt: endExclusive },
          },
        },
        {
          $group: {
            _id: '$channel',
            deliveries: { $sum: 1 },
            interactions: {
              $sum: {
                $cond: [{ $ifNull: ['$interactionAt', false] }, 1, 0],
              },
            },
            conversions: {
              $sum: {
                $cond: [{ $ifNull: ['$conversionAt', false] }, 1, 0],
              },
            },
          },
        },
        { $sort: { deliveries: -1 } },
      ])
      .exec();

    let deliveries = 0;
    let interactions = 0;
    let conversions = 0;
    const byChannel = rows.map((r) => {
      deliveries += r.deliveries;
      interactions += r.interactions;
      conversions += r.conversions;
      return {
        channel: String(r._id ?? ''),
        deliveries: r.deliveries,
        interactions: r.interactions,
        conversions: r.conversions,
      };
    });
    return { deliveries, interactions, conversions, byChannel };
  }
}
