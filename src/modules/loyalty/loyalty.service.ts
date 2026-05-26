import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LoyaltySettingsModel } from '@schemas/loyalty-settings.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';
import {
  LOYALTY_CURRENCY,
  LOYALTY_ORDER_CREDIT_REASON_PREFIX,
  LOYALTY_REWARD_CATALOG,
} from './loyalty.constants';
import {
  isMemberActive,
  loyaltyProgressPercent,
  loyaltyTierFromPoints,
  pointsUsedFromRewardHistory,
} from './loyalty.helpers';
import {
  accumulationRulesFromConfig,
  configFromDocument,
  defaultLoyaltyConfig,
  mergeTierMetadata,
  type ResolvedLoyaltyConfig,
  validateTierChain,
} from './loyalty-settings.util';

const SETTINGS_KEY = 'default';

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
    currency: string;
    inactiveDays: number;
    cadPerPoint: number;
    welcomeBonusPoints: number;
    tiers: ResolvedLoyaltyConfig['tiers'];
    accumulationRules: Array<{ key: string; value: string }>;
    canEdit: boolean;
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

  @InjectModel(LoyaltySettingsModel.name)
  private readonly _settingsModel: Model<LoyaltySettingsModel>;

  private async resolveConfig(): Promise<ResolvedLoyaltyConfig> {
    let doc = await this._settingsModel
      .findOne({ key: SETTINGS_KEY })
      .lean()
      .exec();
    if (!doc) {
      const def = defaultLoyaltyConfig();
      const created = await this._settingsModel.create({
        key: SETTINGS_KEY,
        currency: def.currency,
        inactiveDays: def.inactiveDays,
        cadPerPoint: def.cadPerPoint,
        welcomeBonusPoints: def.welcomeBonusPoints,
        tiers: def.tiers,
      });
      doc = created.toObject();
    }
    return configFromDocument(doc as Record<string, unknown>);
  }

  async getSettings(caller: UserModel) {
    this._assertAdmin(caller);
    const config = await this.resolveConfig();
    return {
      key: SETTINGS_KEY,
      currency: config.currency,
      inactiveDays: config.inactiveDays,
      cadPerPoint: config.cadPerPoint,
      welcomeBonusPoints: config.welcomeBonusPoints,
      tiers: config.tiers.map((t) => ({
        name: t.name,
        min: t.min,
        max: t.max,
        icon: t.icon,
        color: t.color,
        bg: t.bg,
        advantages: t.advantages,
      })),
    };
  }

  async updateSettings(caller: UserModel, dto: UpdateLoyaltySettingsDto) {
    this._assertAdmin(caller);
    const current = await this.resolveConfig();
    const cadPerPoint =
      dto.cadPerPoint != null
        ? Math.floor(dto.cadPerPoint)
        : current.cadPerPoint;
    const inactiveDays =
      dto.inactiveDays != null
        ? Math.floor(dto.inactiveDays)
        : current.inactiveDays;
    const welcomeBonusPoints =
      dto.welcomeBonusPoints != null
        ? Math.floor(dto.welcomeBonusPoints)
        : current.welcomeBonusPoints;

    let tiers = current.tiers;
    if (dto.tiers?.length) {
      const patchByName = new Map(dto.tiers.map((t) => [t.name, t]));
      tiers = mergeTierMetadata(
        current.tiers.map((t) => {
          const patch = patchByName.get(t.name);
          return {
            name: t.name,
            min: patch?.min ?? t.min,
            max: null,
          };
        }),
      );
      validateTierChain(tiers);
    }

    await this._settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            currency: LOYALTY_CURRENCY,
            inactiveDays,
            cadPerPoint,
            welcomeBonusPoints,
            tiers,
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    return this.getSettings(caller);
  }

  tierLabelForPoints(points: number, config?: ResolvedLoyaltyConfig): string {
    const cfg = config ?? defaultLoyaltyConfig();
    return loyaltyTierFromPoints(points, cfg.tiers);
  }

  async tierLabelForPointsAsync(points: number): Promise<string> {
    const config = await this.resolveConfig();
    return loyaltyTierFromPoints(points, config.tiers);
  }

  private _assertAdmin(caller: UserModel) {
    if (!caller || caller.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  private pointsForOrderTotal(
    totalPrice: number,
    config: ResolvedLoyaltyConfig,
  ): number {
    const amount = Math.max(0, Number(totalPrice) || 0);
    const unit = Math.max(1, config.cadPerPoint);
    return Math.floor(amount / unit);
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

    const uid = this._userIdFromOrderLean(order.user);
    if (!uid) return;

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
    const config = await this.resolveConfig();
    const points = this.pointsForOrderTotal(total, config);
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

    const config = await this.resolveConfig();
    const welcomeReason = 'welcome:loyalty_program';
    const history = user.rewardHistory ?? [];
    if (history.some((h) => h.reason === welcomeReason)) return;

    const bonus = config.welcomeBonusPoints;
    if (bonus <= 0) return;

    history.push({
      points: bonus,
      reason: 'Bienvenue au programme fidélité',
      createdAt: new Date(),
    });
    user.rewardHistory = history;
    user.loyaltyPoints = Number(user.loyaltyPoints ?? 0) + bonus;
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

    const config = await this.resolveConfig();
    const canEdit = caller.type === UserTypeEnum.ADMIN;

    if (caller.type === UserTypeEnum.VENDOR && !storeFilter?.length) {
      return this._emptyDashboard(config, canEdit);
    }

    const userIds = await this._distinctBuyerIds(storeFilter);
    if (!userIds.length) {
      return this._emptyDashboard(config, canEdit);
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
        tier: loyaltyTierFromPoints(points, config.tiers),
        loyaltyPoints: points,
        pointsUsed: pointsUsedFromRewardHistory(history),
        ordersCount: stats?.orderCount ?? 0,
        totalSpent: Math.round((stats?.totalSpent ?? 0) * 100) / 100,
        lastOrderAt: lastOrderAt ? lastOrderAt.toISOString() : null,
        active: isMemberActive(lastOrderAt, config.inactiveDays),
        progressPercent: loyaltyProgressPercent(points, config.tiers),
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

    const tierCounts = config.tiers.map((t) => ({
      tier: t.name,
      count: members.filter((m) => m.tier === t.name).length,
    }));

    return {
      config: {
        inactiveDays: config.inactiveDays,
        fcfaPerPoint: config.fcfaPerPoint,
        welcomeBonusPoints: config.welcomeBonusPoints,
        tiers: config.tiers,
        accumulationRules: accumulationRulesFromConfig(config),
        canEdit,
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

  private _emptyDashboard(
    config: ResolvedLoyaltyConfig,
    canEdit: boolean,
  ): LoyaltyDashboardResponse {
    return {
      config: {
        currency: config.currency,
        inactiveDays: config.inactiveDays,
        cadPerPoint: config.cadPerPoint,
        welcomeBonusPoints: config.welcomeBonusPoints,
        tiers: config.tiers,
        accumulationRules: accumulationRulesFromConfig(config),
        canEdit,
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
      tierCounts: config.tiers.map((t) => ({
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

  private _userIdFromOrderLean(raw: unknown): string | undefined {
    if (raw == null) return undefined;
    if (raw instanceof Types.ObjectId) return raw.toHexString();
    if (raw && typeof raw === 'object' && '_id' in raw) {
      const id = (raw as { _id: unknown })._id;
      return id instanceof Types.ObjectId ? id.toHexString() : String(id);
    }
    const s = String(raw).trim();
    return Types.ObjectId.isValid(s) ? s : undefined;
  }
}
