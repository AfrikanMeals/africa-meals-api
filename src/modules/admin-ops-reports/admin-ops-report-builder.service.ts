import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DashboardService } from '@modules/dashboard/dashboard.service';
import { DbMaintenanceService } from '@modules/db-maintenance/db-maintenance.service';
import type { OpsReportPeriodBounds } from '@modules/admin-ops-reports/admin-ops-report-period.util';
import {
  buildOpsReportWorkbook,
  type OpsReportSheet,
} from '@modules/admin-ops-reports/admin-ops-report-excel.util';
import {
  AdCampaignEventModel,
  AdCampaignEventTypeEnum,
} from '@schemas/ad-campaign-event.schema';
import { AdEventModel, AdEventTypeEnum } from '@schemas/ad-event.schema';
import { AdNotificationEventModel } from '@schemas/ad-notification-event.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Model, Types } from 'mongoose';

dayjs.extend(utc);
dayjs.extend(timezone);

export type AdminOpsReportBuildResult = {
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
    private readonly dbMaintenance: DbMaintenanceService,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(AdEventModel.name)
    private readonly adEventModel: Model<AdEventModel>,
    @InjectModel(AdCampaignEventModel.name)
    private readonly adCampaignEventModel: Model<AdCampaignEventModel>,
    @InjectModel(AdNotificationEventModel.name)
    private readonly adNotificationEventModel: Model<AdNotificationEventModel>,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
  ) {}

  async build(bounds: OpsReportPeriodBounds): Promise<AdminOpsReportBuildResult> {
    const z = bounds.timezone;
    const start = dayjs.tz(bounds.from, z).startOf('day').toDate();
    const endExclusive = dayjs.tz(bounds.to, z).add(1, 'day').startOf('day').toDate();

    const adminUser = await this.userModel
      .findOne({ type: UserTypeEnum.ADMIN })
      .sort({ createdAt: 1 })
      .exec();
    if (!adminUser) {
      throw new Error('no_admin_user_for_ops_report');
    }

    const [
      finance,
      bannerAgg,
      campaignAgg,
      notificationAgg,
      stuckCreated,
      healthChecks,
    ] = await Promise.all([
      this.dashboard.getFinancePeriodReport(
        adminUser,
        bounds.from,
        bounds.to,
      ),
      this.aggregateAdEvents(start, endExclusive),
      this.aggregateCampaignEvents(start, endExclusive),
      this.aggregateNotificationEvents(start, endExclusive),
      this.orderModel.countDocuments({
        status: OrderStatusEnum.CREATED,
        createdAt: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      }),
      this.dbMaintenance.runAllSystemHealthChecksInternal(),
    ]);

    const s = finance.summary;
    const periodLabel = bounds.labelFr;

    const resumeSheet: OpsReportSheet = {
      name: 'Résumé',
      headers: ['Indicateur', 'Valeur'],
      rows: [
        ['Période', periodLabel],
        ['Du', bounds.from],
        ['Au', bounds.to],
        ['Fuseau', z],
        ['Commandes (payées)', s.orderCount],
        ['CA total', s.totalRevenue],
        ['Panier moyen', s.avgOrderValue],
        ['Livraison', s.shippingTotal],
        ['Tendance CA %', s.trendPercent ?? '—'],
        ['Ad Credit payé', s.adCredit?.paidTotal ?? 0],
        ['Paiements Ad Credit', s.adCredit?.paymentCount ?? 0],
        ['Impressions bannières', bannerAgg.impressions],
        ['Clics bannières', bannerAgg.clicks],
        ['Conversions bannières', bannerAgg.conversions],
        ['Impressions campagnes', campaignAgg.impressions],
        ['Clics campagnes', campaignAgg.clicks],
        ['Conversions campagnes', campaignAgg.conversions],
        ['Livraisons notifications', notificationAgg.deliveries],
        ['Interactions notifications', notificationAgg.interactions],
        ['Conversions notifications', notificationAgg.conversions],
        ['Commandes bloquées (created >2h)', stuckCreated],
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

    const healthSheet: OpsReportSheet = {
      name: 'Santé système',
      headers: ['Check', 'Statut', 'Score', 'Détails'],
      rows: healthChecks.map((h) => [
        h.label,
        h.status,
        h.score,
        h.details,
      ]),
    };

    const sheets = [
      resumeSheet,
      ordersSheet,
      financeDailySheet,
      bannersSheet,
      campaignsSheet,
      notificationsSheet,
      healthSheet,
    ];

    const workbook = await buildOpsReportWorkbook(sheets);
    const safePeriod = bounds.periodKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `rapport-ops_${safePeriod}.xlsx`;

    const htmlSummary = `
      <h2>Rapport opérations — ${periodLabel}</h2>
      <p><strong>Période :</strong> ${bounds.from} → ${bounds.to} (${z})</p>
      <ul>
        <li>Commandes : <strong>${s.orderCount}</strong> — CA <strong>${s.totalRevenue}</strong></li>
        <li>Bannières : ${bannerAgg.impressions} impr. / ${bannerAgg.clicks} clics / ${bannerAgg.conversions} conv.</li>
        <li>Campagnes : ${campaignAgg.impressions} impr. / ${campaignAgg.clicks} clics / ${campaignAgg.conversions} conv.</li>
        <li>Notifications : ${notificationAgg.deliveries} livraisons / ${notificationAgg.interactions} interactions</li>
        <li>Santé système : ${healthChecks.filter((h) => h.status === 'healthy').length}/${healthChecks.length} checks OK</li>
      </ul>
      <p>Le fichier Excel joint contient ${sheets.length} onglets détaillés.</p>
    `.trim();

    return {
      bounds,
      sheets,
      workbook,
      htmlSummary,
      filename,
    };
  }

  private async aggregateAdEvents(start: Date, endExclusive: Date) {
    const rows = await this.adEventModel
      .aggregate<{
        _id: Types.ObjectId;
        impressions: number;
        clicks: number;
        conversions: number;
      }>([
        { $match: { createdAt: { $gte: start, $lt: endExclusive } } },
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
        { $limit: 500 },
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

  private async aggregateCampaignEvents(start: Date, endExclusive: Date) {
    const rows = await this.adCampaignEventModel
      .aggregate<{
        _id: Types.ObjectId;
        impressions: number;
        clicks: number;
        conversions: number;
      }>([
        { $match: { createdAt: { $gte: start, $lt: endExclusive } } },
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
        { $limit: 500 },
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

  private async aggregateNotificationEvents(start: Date, endExclusive: Date) {
    const rows = await this.adNotificationEventModel
      .aggregate<{
        _id: string;
        deliveries: number;
        interactions: number;
        conversions: number;
      }>([
        { $match: { deliveredAt: { $gte: start, $lt: endExclusive } } },
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
