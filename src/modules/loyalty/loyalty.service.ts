import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  LOYALTY_INACTIVE_DAYS,
  LOYALTY_ORDER_CREDIT_REASON_PREFIX,
  LOYALTY_POINTS_PER_100_FCFA,
  LOYALTY_REWARD_CATALOG,
  LOYALTY_TIER_THRESHOLDS,
  LOYALTY_WELCOME_BONUS_POINTS,
} from './loyalty.constants';
import {
  isMemberActive,
  loyaltyProgressPercent,
  loyaltyTierFromPoints,
  pointsUsedFromRewardHistory,
} from './loyalty.helpers';

const CLIENT_ORDER_STATUSES: OrderStatusEnum[] = [
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.COMPLETED,
];

export type LoyaltyMemberRow = {
  id: string;
  fullName: string;
  email: string;
  profileImage: string | null;
  tier: string;
  loyaltyPoints: number;
  pointsUsed: number;
  ordersCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
  active: boolean;
  progressPercent: number;
  rewardProgramEligible: boolean;
};

export type LoyaltyDashboardResponse = {
  config: {
    inactiveDays: number;
    pointsPer100Fcfa: number;
    welcomeBonusPoints: number;
    tiers: typeof LOYALTY_TIER_THRESHOLDS;
    accumulationRules: Array<{ key: string; value: string }>;
  };
  stats: {
    activeMembers: number;
    inactiveMembers: number;
    totalPointsInCirculation: number;
    totalPointsRedeemed: number;
    engagementRatePercent: number;
    eligibleMembers: number;
    pendingEnrollment: number;
  };
  tierCounts: Array<{ tier: string; count: number }>;
  members: LoyaltyMemberRow[];
  rewardsCatalog: typeof LOYALTY_REWARD_CATALOG;
};

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  pointsForOrderTotal(totalPrice: number): number {
    const amount = Math.max(0, Number(totalPrice) || 0);
    return Math.floor(amount / 100) * LOYALTY_POINTS_PER_100_FCFA;
  }

  /**
   * Crédite les points après commande `completed` (idempotent par commande).
   */
  async creditOrderCompletion(orderId: string): Promise<void> {
    const oid = String(orderId ?? '').trim();
    if (!Types.ObjectId.isValid(oid)) return;

    const order = await this._orderModel
      .findById(oid)
      .select('user status totalPrice total_price loyaltyPointsCredited')
      .lean()
      .exec();
    if (!order) return;
    if (order.status !== OrderStatusEnum.COMPLETED) return;
    if (order.loyaltyPointsCredited === true) return;

    const userId = order.user;
    if (!userId) return;
    const uid =
      userId instanceof Types.ObjectId
        ? userId.toHexString()
        : String(userId);
    if (!Types.ObjectId.isValid(uid)) return;

    const user = await this._userModel
      .findById(uid)
      .select('rewardProgramEligible loyaltyPoints rewardHistory')
      .exec();
    if (!user?.rewardProgramEligible) return;

    const total = Number(
      (order as { totalPrice?: number; total_price?: number }).totalPrice ??
        (order as { total_price?: number }).total_price ??
        0,
    );
    const points = this.pointsForOrderTotal(total);
    if (points <= 0) {
      await this._orderModel.updateOne(
        { _id: oid },
        { $set: { loyaltyPointsCredited: true } },
      );
      return;
    }

    const reason = `${LOYALTY_ORDER_CREDIT_REASON_PREFIX}${oid}`;
    const history = user.rewardHistory ?? [];
    if (history.some((h) => h.reason === reason)) {
      await this._orderModel.updateOne(
        { _id: oid },
        { $set: { loyaltyPointsCredited: true } },
      );
      return;
    }

    history.push({
      points,
      reason: `Commande livrée (+${points} pts)`,
      createdAt: new Date(),
    });
    user.rewardHistory = history;
    user.loyaltyPoints = Number(user.loyaltyPoints ?? 0) + points;
    await user.save();
    await this._orderModel.updateOne(
      { _id: oid },
      { $set: { loyaltyPointsCredited: true } },
    );
  }

  /** Bonus de bienvenue à l’activation admin du programme. */
  async grantWelcomeBonusIfNeeded(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return;
    const user = await this._userModel.findById(userId).exec();
    if (!user?.rewardProgramEligible) return;

    const welcomeReason = 'welcome:loyalty_program';
    const history = user.rewardHistory ?? [];
    if (history.some((h) => h.reason === welcomeReason)) return;

    history.push({
      points: LOYALTY_WELCOME_BONUS_POINTS,
      reason: 'Bienvenue au programme fidélité',
      createdAt: new Date(),
    });
    user.rewardHistory = history;
    user.loyaltyPoints =
      Number(user.loyaltyPoints ?? 0) + LOYALTY_WELCOME_BONUS_POINTS;
    await user.save();
  }

  async getDashboard(caller: UserModel): Promise<LoyaltyDashboardResponse> {
    if (!caller) {
      throw new ForbiddenException('loyalty_access_denied');
    }
    if (
      caller.type !== UserTypeEnum.ADMIN &&
      caller.type !== UserTypeEnum.VENDOR
    ) {
      throw new ForbiddenException('loyalty_access_denied');
    }
    const storeFilter =
      caller.type === UserTypeEnum.VENDOR
        ? await this._vendorStoreIds(caller)
        : null;

    if (caller.type === UserTypeEnum.VENDOR && !storeFilter?.length) {
      return this._emptyDashboard();
    }

    const userIds = await this._distinctBuyerIds(storeFilter);
    if (!userIds.length) {
      return this._emptyDashboard();
    }

    const users = await this._userModel
      .find({ _id: { $in: userIds } })
      .select(
        'fullName email profileImage loyaltyPoints rewardHistory rewardProgramEligible',
      )
      .lean()
      .exec();

    const spendMap = await this._orderStatsByUser(userIds, storeFilter);
    const eligibleUsers = users.filter(
      (u) =>
        Boolean(
          (u as { rewardProgramEligible?: boolean }).rewardProgramEligible,
        ),
    );
    const pendingEnrollment = users.filter(
      (u) =>
        !(u as { rewardProgramEligible?: boolean }).rewardProgramEligible,
    ).length;

    const members: LoyaltyMemberRow[] = eligibleUsers.map((u) => {
      const id = String(u._id);
      const stats = spendMap.get(id);
      const history =
        (u as { rewardHistory?: Array<{ points?: number }> }).rewardHistory ??
        [];
      const points = Number(
        (u as { loyaltyPoints?: number }).loyaltyPoints ?? 0,
      );
      const lastOrderAt = stats?.lastOrderAt ?? null;
      return {
        id,
        fullName: String((u as { fullName?: string }).fullName ?? '').trim(),
        email: String((u as { email?: string }).email ?? ''),
        profileImage:
          typeof (u as { profileImage?: string }).profileImage === 'string' &&
          (u as { profileImage: string }).profileImage.trim()
            ? (u as { profileImage: string }).profileImage.trim()
            : null,
        tier: loyaltyTierFromPoints(points),
        loyaltyPoints: points,
        pointsUsed: pointsUsedFromRewardHistory(history),
        ordersCount: stats?.orderCount ?? 0,
        totalSpent: Math.round((stats?.totalSpent ?? 0) * 100) / 100,
        lastOrderAt: lastOrderAt ? lastOrderAt.toISOString() : null,
        active: isMemberActive(lastOrderAt, LOYALTY_INACTIVE_DAYS),
        progressPercent: loyaltyProgressPercent(points),
        rewardProgramEligible: true,
      };
    });

    members.sort((a, b) => b.loyaltyPoints - a.loyaltyPoints);

    const activeMembers = members.filter((m) => m.active).length;
    const inactiveMembers = members.length - activeMembers;
    const totalPointsInCirculation = members.reduce(
      (s, m) => s + m.loyaltyPoints,
      0,
    );
    const totalPointsRedeemed = members.reduce((s, m) => s + m.pointsUsed, 0);
    const engagementRatePercent =
      members.length > 0
        ? Math.round((activeMembers / members.length) * 100)
        : 0;

    const tierCounts = LOYALTY_TIER_THRESHOLDS.map((t) => ({
      tier: t.name,
      count: members.filter((m) => m.tier === t.name).length,
    }));

    return {
      config: {
        inactiveDays: LOYALTY_INACTIVE_DAYS,
        pointsPer100Fcfa: LOYALTY_POINTS_PER_100_FCFA,
        welcomeBonusPoints: LOYALTY_WELCOME_BONUS_POINTS,
        tiers: LOYALTY_TIER_THRESHOLDS,
        accumulationRules: [
          {
            key: '1 point équivaut à',
            value: `${LOYALTY_POINTS_PER_100_FCFA * 100} FCFA dépensés`,
          },
          {
            key: 'Bonus activation programme',
            value: `${LOYALTY_WELCOME_BONUS_POINTS} points`,
          },
          {
            key: 'Crédit automatique',
            value: 'À chaque commande livrée (statut completed)',
          },
          {
            key: 'Éligibilité',
            value: 'Activation manuelle par un administrateur',
          },
        ],
      },
      stats: {
        activeMembers,
        inactiveMembers,
        totalPointsInCirculation,
        totalPointsRedeemed,
        engagementRatePercent,
        eligibleMembers: members.length,
        pendingEnrollment,
      },
      tierCounts,
      members,
      rewardsCatalog: LOYALTY_REWARD_CATALOG,
    };
  }

  private _emptyDashboard(): LoyaltyDashboardResponse {
    return {
      config: {
        inactiveDays: LOYALTY_INACTIVE_DAYS,
        pointsPer100Fcfa: LOYALTY_POINTS_PER_100_FCFA,
        welcomeBonusPoints: LOYALTY_WELCOME_BONUS_POINTS,
        tiers: LOYALTY_TIER_THRESHOLDS,
        accumulationRules: [
          {
            key: '1 point équivaut à',
            value: `${LOYALTY_POINTS_PER_100_FCFA * 100} FCFA dépensés`,
          },
          {
            key: 'Bonus activation programme',
            value: `${LOYALTY_WELCOME_BONUS_POINTS} points`,
          },
          {
            key: 'Crédit automatique',
            value: 'À chaque commande livrée (statut completed)',
          },
          {
            key: 'Éligibilité',
            value: 'Activation manuelle par un administrateur',
          },
        ],
      },
      stats: {
        activeMembers: 0,
        inactiveMembers: 0,
        totalPointsInCirculation: 0,
        totalPointsRedeemed: 0,
        engagementRatePercent: 0,
        eligibleMembers: 0,
        pendingEnrollment: 0,
      },
      tierCounts: LOYALTY_TIER_THRESHOLDS.map((t) => ({
        tier: t.name,
        count: 0,
      })),
      members: [],
      rewardsCatalog: LOYALTY_REWARD_CATALOG,
    };
  }

  private async _vendorStoreIds(
    caller: UserModel,
  ): Promise<Types.ObjectId[] | null> {
    const stores = await this._storeModel
      .find({ owner: caller._id })
      .select('_id')
      .lean()
      .exec();
    return stores.map((s) => s._id as Types.ObjectId);
  }

  private async _distinctBuyerIds(
    storeFilter: Types.ObjectId[] | null,
  ): Promise<Types.ObjectId[]> {
    const match: Record<string, unknown> = {
      status: { $in: CLIENT_ORDER_STATUSES },
    };
    if (storeFilter?.length) {
      match.store = { $in: storeFilter };
    }
    const raw = await this._orderModel.distinct('user', match);
    const out: Types.ObjectId[] = [];
    const seen = new Set<string>();
    for (const id of raw as (Types.ObjectId | string)[]) {
      const hex =
        id instanceof Types.ObjectId ? id.toHexString() : String(id);
      if (!Types.ObjectId.isValid(hex) || seen.has(hex)) continue;
      seen.add(hex);
      out.push(new Types.ObjectId(hex));
    }
    return out;
  }

  private async _orderStatsByUser(
    userIds: Types.ObjectId[],
    storeFilter: Types.ObjectId[] | null,
  ): Promise<
    Map<
      string,
      { orderCount: number; totalSpent: number; lastOrderAt: Date | null }
    >
  > {
    const map = new Map<
      string,
      { orderCount: number; totalSpent: number; lastOrderAt: Date | null }
    >();
    if (!userIds.length) return map;

    const match: Record<string, unknown> = {
      user: { $in: userIds },
      status: { $in: CLIENT_ORDER_STATUSES },
    };
    if (storeFilter?.length) {
      match.store = { $in: storeFilter };
    }

    const agg = await this._orderModel
      .aggregate<{
        _id: Types.ObjectId;
        orderCount: number;
        totalSpent: number;
        lastOrderAt: Date;
      }>([
        { $match: match },
        {
          $group: {
            _id: '$user',
            orderCount: { $sum: 1 },
            totalSpent: {
              $sum: {
                $ifNull: ['$totalPrice', { $ifNull: ['$total_price', 0] }],
              },
            },
            lastOrderAt: { $max: '$updatedAt' },
          },
        },
      ])
      .exec();

    for (const row of agg) {
      map.set(String(row._id), {
        orderCount: row.orderCount ?? 0,
        totalSpent: Number(row.totalSpent ?? 0),
        lastOrderAt: row.lastOrderAt ?? null,
      });
    }
    return map;
  }
}
