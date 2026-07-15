import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { DeliveryAgentOrderRatingModel } from '@schemas/delivery-agent-order-rating.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { serializePartnerBadge } from '@common/partner-badges/partner-badge.constants';
import {
  countActiveShippedOrdersForAgent,
  maxConcurrentOrdersFromApplication,
} from './delivery-agent-capacity.util';
import { resolveDeliveryAgentPresence } from './delivery-agent-domain.util';
import { CourierPerformanceStatsService } from './courier-performance-stats.service';
import {
  buildCourierStatusPerformanceOverview,
  type CourierStatusPerformanceOverview,
} from './courier-status-performance.util';

/**
 * Charge et assemble l’overview Performance & Statut d’un livreur.
 * Partagé admin / vendeur (flag includeFinancials).
 */
@Injectable()
export class CourierStatusPerformanceService {
  constructor(
    @InjectModel(UserModel.name)
    private readonly _users: Model<UserModel>,
    @InjectModel(DeliveryAgentApplicationModel.name)
    private readonly _applications: Model<DeliveryAgentApplicationModel>,
    @InjectModel(OrderModel.name)
    private readonly _orders: Model<OrderModel>,
    @InjectModel(DeliveryAgentOrderRatingModel.name)
    private readonly _courierRatings: Model<DeliveryAgentOrderRatingModel>,
    private readonly _courierPerf: CourierPerformanceStatsService,
  ) {}

  /**
   * Overview pour un user livreur.
   * includeFinancials=false → jamais de gains (surface vendeur).
   */
  async buildForAgentUserId(
    agentUserId: string,
    opts: { includeFinancials: boolean; maskStripeAccountId?: boolean },
  ): Promise<CourierStatusPerformanceOverview> {
    const uid = String(agentUserId ?? '').trim();
    if (!Types.ObjectId.isValid(uid)) {
      throw new NotFoundException('user_not_found');
    }
    const agentOid = new Types.ObjectId(uid);
    const agentUser = await this._users.findById(agentOid).exec();
    if (!agentUser) {
      throw new NotFoundException('user_not_found');
    }

    const app = await this._applications
      .findOne({ user: agentOid })
      .sort({ updatedAt: -1 })
      .select('status dashboardAvailability maxConcurrentOrders')
      .lean()
      .exec();

    const applicationStatus = String(app?.status ?? 'UNKNOWN');
    const applicationId = app?._id ? String(app._id) : null;

    const [activeCount, perfPayload, ratingAgg, financials] = await Promise.all(
      [
        app?.status === DeliveryAgentApplicationStatus.APPROVED
          ? countActiveShippedOrdersForAgent(this._orders, agentOid)
          : Promise.resolve(0),
        this._courierPerf.getOrCreate(uid),
        this._courierRatings
          .aggregate<{ avg?: number; count?: number }>([
            { $match: { deliveryAgent: agentOid } },
            {
              $group: {
                _id: null,
                avg: { $avg: '$rate' },
                count: { $sum: 1 },
              },
            },
          ])
          .exec(),
        opts.includeFinancials
          ? this.loadFinancialTotals(agentOid)
          : Promise.resolve(null),
      ],
    );

    // Présence seulement si candidature approuvée (sinon hors ligne métier).
    let presence = null as ReturnType<
      typeof buildCourierStatusPerformanceOverview
    >['status']['presence'];
    if (app?.status === DeliveryAgentApplicationStatus.APPROVED) {
      const availability =
        app.dashboardAvailability === 'hors_ligne'
          ? 'hors_ligne'
          : 'disponible';
      presence = {
        availability,
        presence: resolveDeliveryAgentPresence(availability, activeCount),
        activeOrderCount: activeCount,
        maxConcurrentOrders: maxConcurrentOrdersFromApplication(app),
      };
    }

    const ratingRow = ratingAgg[0];
    const ratingCount = Math.max(0, Math.round(Number(ratingRow?.count ?? 0)));
    const avgRaw = Number(ratingRow?.avg ?? NaN);
    const averageRating =
      ratingCount > 0 && Number.isFinite(avgRaw)
        ? Math.round(avgRaw * 10) / 10
        : null;

    const counters = {
      offersPresented: Number(perfPayload?.offersPresented ?? 0),
      offersAccepted: Number(perfPayload?.offersAccepted ?? 0),
      offersRejected: Number(perfPayload?.offersRejected ?? 0),
      offersExpired: Number(perfPayload?.offersExpired ?? 0),
      marketplaceNotified: Number(perfPayload?.marketplaceNotified ?? 0),
      marketplaceClaims: Number(perfPayload?.marketplaceClaims ?? 0),
      marketplaceMissed: Number(perfPayload?.marketplaceMissed ?? 0),
      unassignByCourier: Number(perfPayload?.unassignByCourier ?? 0),
      unassignByOther: Number(perfPayload?.unassignByOther ?? 0),
      completedDeliveries: Number(perfPayload?.completedDeliveries ?? 0),
      totalDeliveryDurationSec: Number(
        perfPayload?.totalDeliveryDurationSec ?? 0,
      ),
      totalDistanceKm: Number(perfPayload?.totalDistanceKm ?? 0),
    };

    // Le webhook Stripe maintient ces flags en Mongo ; une lecture d’overview ne doit
    // ni appeler Stripe ni créer un cycle DI avec BillingModule → StoreModule.
    const stripeAccountId =
      String(agentUser.stripeConnectAccountId ?? '').trim() || null;
    const stripeRequirementsDue = agentUser.stripeConnectRequirementsDue ?? [];
    const stripeRequirementsPastDue =
      agentUser.stripeConnectRequirementsPastDue ?? [];
    const stripeDisabledReason = String(
      agentUser.stripeConnectDisabledReason ?? '',
    ).trim();
    const stripeOnboardingComplete =
      stripeAccountId !== null &&
      agentUser.stripeConnectDetailsSubmitted === true &&
      agentUser.stripeConnectChargesEnabled === true &&
      agentUser.stripeConnectPayoutsEnabled === true &&
      stripeRequirementsDue.length === 0 &&
      stripeRequirementsPastDue.length === 0 &&
      stripeDisabledReason.length === 0;

    return buildCourierStatusPerformanceOverview({
      userId: uid,
      applicationId,
      displayName:
        agentUser.fullName?.trim() || agentUser.email?.trim() || 'Livreur',
      applicationStatus,
      partnerBadge: serializePartnerBadge(agentUser.partnerBadgeCode),
      presence,
      stripe: {
        onboardingComplete: stripeOnboardingComplete,
        chargesEnabled: agentUser.stripeConnectChargesEnabled === true,
        payoutsEnabled: agentUser.stripeConnectPayoutsEnabled === true,
        accountId: stripeAccountId,
      },
      counters,
      averageRating,
      ratingCount,
      includeFinancials: opts.includeFinancials,
      financials,
      maskStripeAccountId: opts.maskStripeAccountId === true,
    });
  }

  /**
   * Totaux gains / shipping pour admin (pas d’items transactionnels).
   * Gains livreur = montants déjà transferés Connect (centimes Stripe).
   */
  private async loadFinancialTotals(agentOid: Types.ObjectId) {
    const deliveredStatuses = [
      OrderStatusEnum.SHIPPED,
      OrderStatusEnum.COMPLETED,
    ];
    const rows = await this._orders
      .aggregate<{
        total?: number;
        revenueTotal?: number;
        transferCents?: number;
        tipCents?: number;
        currency?: string;
      }>([
        {
          $match: {
            shouldShip: true,
            assignedDeliveryUser: agentOid,
            status: { $in: deliveredStatuses },
            courierAbandonNoPayout: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            // Tolère les documents historiques camelCase et le mapping snake_case actuel.
            revenueTotal: {
              $sum: {
                $ifNull: [
                  '$shippingPrice',
                  { $ifNull: ['$shipping_price', 0] },
                ],
              },
            },
            transferCents: {
              $sum: {
                $ifNull: [
                  '$stripeDeliveryTransferAmountCents',
                  { $ifNull: ['$stripe_delivery_transfer_amount_cents', 0] },
                ],
              },
            },
            tipCents: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      {
                        $ifNull: ['$deliveryTipStatus', '$delivery_tip_status'],
                      },
                      'transferred',
                    ],
                  },
                  {
                    $ifNull: [
                      '$stripeDeliveryTipTransferAmountCents',
                      {
                        $ifNull: [
                          '$stripe_delivery_tip_transfer_amount_cents',
                          0,
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
            },
            currency: { $first: '$currency' },
          },
        },
      ])
      .exec();

    const d = rows[0];
    return {
      ordersDeliveredTotal: Number(d?.total ?? 0),
      shippingRevenueTotal:
        Math.round(Number(d?.revenueTotal ?? 0) * 100) / 100,
      driverEarningTotal: Math.round(Number(d?.transferCents ?? 0)) / 100,
      driverTipEarningTotal: Math.round(Number(d?.tipCents ?? 0)) / 100,
      currency: d?.currency ? String(d.currency) : null,
    };
  }
}
