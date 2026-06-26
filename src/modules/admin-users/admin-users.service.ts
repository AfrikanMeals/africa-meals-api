import { AuthService } from '@modules/auth/auth.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AdsTargetingProfileModel } from '@schemas/ads-targeting-profile.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserRecommendationDigestModel } from '@schemas/user-recommendation-digest.schema';
import {
  UserRecommendationSignalKind,
  UserRecommendationSignalModel,
} from '@schemas/user-recommendation-signal.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { buildCaseInsensitiveExactRegex } from '@common/mongo/escape-regex.util';
import { FilterQuery, Model, Types } from 'mongoose';
import type { AdminUserInterestsResponse } from './admin-user-interests.types';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { AdminSetUserDisabledDto } from './dto/admin-set-user-disabled.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';

const PAID_LIKE_ORDER_STATUSES: OrderStatusEnum[] = [
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.COMPLETED,
];

export type AdminUserAuthMethod =
  | 'google'
  | 'apple'
  | 'facebook'
  | 'email';

export type AdminUserRow = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  type: UserTypeEnum;
  appCountryCode: string | null;
  emailVerified: boolean;
  authMethods: AdminUserAuthMethod[];
  disabled: boolean;
  debug: boolean;
  canMessaging: boolean;
  messagingBanReason: string | null;
  accountDisabledAt: string | null;
  deletionPending: boolean;
  accountDeletionRequestedAt: string | null;
  accountDeletionScheduledFor: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const ADMIN_USER_SELECT =
  'fullName email phoneNumber type appCountryCode emailVerifiedAt googleId appleId facebookId debug canMessaging messagingBanReason accountDisabledAt accountDeletionRequestedAt accountDeletionScheduledFor createdAt updatedAt';

function deriveAuthMethods(doc: Record<string, unknown>): AdminUserAuthMethod[] {
  const methods: AdminUserAuthMethod[] = [];
  if (typeof doc.googleId === 'string' && doc.googleId.trim()) {
    methods.push('google');
  }
  if (typeof doc.appleId === 'string' && doc.appleId.trim()) {
    methods.push('apple');
  }
  if (typeof doc.facebookId === 'string' && doc.facebookId.trim()) {
    methods.push('facebook');
  }
  if (methods.length === 0) {
    methods.push('email');
  }
  return methods;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return null;
}

function serializeUser(doc: Record<string, unknown>): AdminUserRow {
  const disabledAt = doc.accountDisabledAt;
  const deletionRequestedAt = doc.accountDeletionRequestedAt;
  const deletionScheduledFor = doc.accountDeletionScheduledFor;
  return {
    id: String(doc._id ?? ''),
    fullName: String(doc.fullName ?? ''),
    email: String(doc.email ?? ''),
    phoneNumber:
      typeof doc.phoneNumber === 'string' && doc.phoneNumber.trim()
        ? doc.phoneNumber.trim()
        : null,
    type: (doc.type as UserTypeEnum) ?? UserTypeEnum.USER,
    appCountryCode:
      typeof doc.appCountryCode === 'string' ? doc.appCountryCode : null,
    emailVerified: doc.emailVerifiedAt instanceof Date,
    authMethods: deriveAuthMethods(doc),
    disabled: disabledAt instanceof Date,
    debug: doc.debug === true,
    canMessaging: doc.canMessaging !== false,
    messagingBanReason:
      typeof doc.messagingBanReason === 'string' && doc.messagingBanReason.trim()
        ? doc.messagingBanReason.trim()
        : null,
    accountDisabledAt: toIso(disabledAt),
    deletionPending:
      deletionRequestedAt instanceof Date && deletionScheduledFor instanceof Date,
    accountDeletionRequestedAt: toIso(deletionRequestedAt),
    accountDeletionScheduledFor: toIso(deletionScheduledFor),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(AdsTargetingProfileModel.name)
    private readonly adsProfileModel: Model<AdsTargetingProfileModel>,
    @InjectModel(UserRecommendationDigestModel.name)
    private readonly digestModel: Model<UserRecommendationDigestModel>,
    @InjectModel(UserRecommendationSignalModel.name)
    private readonly signalModel: Model<UserRecommendationSignalModel>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    private readonly storeAccess: StoreAccessService,
    private readonly authService: AuthService,
    private readonly supportedCountries: SupportedCountriesService,
  ) {}

  private async assertAdmin(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private assertNotSelf(actor: UserModel, targetUserId: string): void {
    if (String(actor._id) === String(targetUserId)) {
      throw new BadRequestException('cannot_modify_own_account_here');
    }
  }

  async listUsers(
    actor: UserModel,
    query: AdminListUsersQueryDto,
  ): Promise<{
    items: AdminUserRow[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    await this.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const sortField = query.field ?? 'createdAt';
    const sortDir = query.order === 'ASC' ? 1 : -1;
    const filter: FilterQuery<UserModel> = {};

    if (query.type) {
      filter.type = query.type;
    }

    const search = query.search?.trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { email: { $regex: escaped, $options: 'i' } },
        { fullName: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (query.status === 'disabled') {
      filter.accountDisabledAt = { $ne: null };
    } else if (query.status === 'deletion_pending') {
      filter.accountDeletionRequestedAt = { $ne: null };
      filter.accountDeletionScheduledFor = { $ne: null };
    } else if (query.status === 'active') {
      filter.accountDisabledAt = null;
    }

    const [total, rows] = await Promise.all([
      this.userModel.countDocuments(filter).exec(),
      this.userModel
        .find(filter)
        .select(ADMIN_USER_SELECT)
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    return {
      items: rows.map((row) => serializeUser(row as Record<string, unknown>)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getUser(actor: UserModel, userId: string): Promise<AdminUserRow> {
    await this.assertAdmin(actor);
    const id = userId.trim();
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('invalid_user_id');
    }
    const row = await this.userModel
      .findById(id)
      .select(ADMIN_USER_SELECT)
      .lean()
      .exec();
    if (!row) throw new NotFoundException('user_not_found');
    return serializeUser(row as Record<string, unknown>);
  }

  async updateUser(
    actor: UserModel,
    userId: string,
    dto: AdminUpdateUserDto,
  ): Promise<AdminUserRow> {
    await this.assertAdmin(actor);
    this.assertNotSelf(actor, userId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('invalid_user_id');
    }

    const update: Partial<UserModel> = {};
    if (dto.fullName != null) update.fullName = dto.fullName.trim();
    if (dto.phoneNumber != null) update.phoneNumber = dto.phoneNumber.trim();
    if (dto.type != null) update.type = dto.type;
    if (dto.appCountryCode != null) {
      const code = dto.appCountryCode.trim().toUpperCase();
      if (!(await this.supportedCountries.isActiveCode(code))) {
        throw new BadRequestException('unsupported_country_code');
      }
      update.appCountryCode = code;
    }
    if (dto.email != null) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.userModel
        .findOne({
          email: buildCaseInsensitiveExactRegex(email),
          _id: { $ne: userId },
        })
        .select('_id')
        .lean()
        .exec();
      if (existing) throw new ConflictException('email_already_used');
      update.email = email;
    }
    if (dto.debug != null) update.debug = dto.debug === true;
    if (dto.canMessaging != null) {
      update.canMessaging = dto.canMessaging === true;
      if (dto.canMessaging === true) {
        (update as Record<string, unknown>).messagingBanReason = null;
      } else {
        const reason = (dto.messagingBanReason ?? '').trim();
        if (reason.length < 3) {
          throw new BadRequestException('messaging_ban_reason_required');
        }
        update.messagingBanReason = reason;
      }
    } else if (dto.messagingBanReason != null) {
      const reason = dto.messagingBanReason.trim();
      update.messagingBanReason = reason.length > 0 ? reason : undefined;
    }

    if (Object.keys(update).length === 0) {
      return this.getUser(actor, userId);
    }

    const updated = await this.userModel
      .findByIdAndUpdate(userId, { $set: update }, { new: true })
      .select(ADMIN_USER_SELECT)
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('user_not_found');
    return serializeUser(updated as Record<string, unknown>);
  }

  async setUserDisabled(
    actor: UserModel,
    userId: string,
    dto: AdminSetUserDisabledDto,
  ): Promise<AdminUserRow> {
    await this.assertAdmin(actor);
    this.assertNotSelf(actor, userId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('invalid_user_id');
    }

    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        {
          $set: {
            accountDisabledAt: dto.disabled === true ? new Date() : null,
          },
        },
        { new: true },
      )
      .select(ADMIN_USER_SELECT)
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('user_not_found');
    return serializeUser(updated as Record<string, unknown>);
  }

  async deleteUser(
    actor: UserModel,
    userId: string,
  ): Promise<{ message: string; deleted: boolean }> {
    await this.assertAdmin(actor);
    this.assertNotSelf(actor, userId);
    return this.authService.adminDeleteAccountNow(
      String(actor._id),
      userId.trim(),
    );
  }

  async cancelDeletionRequest(
    actor: UserModel,
    userId: string,
  ): Promise<AdminUserRow> {
    await this.assertAdmin(actor);
    await this.authService.adminCancelAccountDeletion(
      String(actor._id),
      userId.trim(),
    );
    return this.getUser(actor, userId);
  }

  async getUserInterests(
    actor: UserModel,
    userId: string,
  ): Promise<AdminUserInterestsResponse> {
    await this.assertAdmin(actor);
    const id = userId.trim();
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('invalid_user_id');
    }
    const userOid = new Types.ObjectId(id);
    const userDoc = await this.userModel
      .findById(userOid)
      .select('fullName email type appCountryCode')
      .lean()
      .exec();
    if (!userDoc) throw new NotFoundException('user_not_found');

    const userKey = id;
    const [
      adsProfile,
      digest,
      recentSignals,
      orderStats,
      topCategoryRows,
      topProductRows,
    ] = await Promise.all([
      this.adsProfileModel.findOne({ userKey }).lean().exec(),
      this.digestModel.findOne({ user: userOid }).lean().exec(),
      this.signalModel
        .find({ user: userOid })
        .sort({ createdAt: -1 })
        .limit(40)
        .lean()
        .exec(),
      this.orderModel
        .aggregate<{ total: number; lastOrderAt: Date | null }>([
          {
            $match: {
              user: userOid,
              status: { $in: PAID_LIKE_ORDER_STATUSES },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              lastOrderAt: { $max: '$createdAt' },
            },
          },
        ])
        .exec(),
      this.orderModel
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              user: userOid,
              status: { $in: PAID_LIKE_ORDER_STATUSES },
            },
          },
          { $unwind: '$items' },
          {
            $match: {
              'items.categoryTitle': { $exists: true, $nin: [null, ''] },
            },
          },
          {
            $group: {
              _id: { $trim: { input: '$items.categoryTitle' } },
              count: { $sum: '$items.quantity' },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 8 },
        ])
        .exec(),
      this.orderModel
        .aggregate<{ _id: string; label: string; count: number }>([
          {
            $match: {
              user: userOid,
              status: { $in: PAID_LIKE_ORDER_STATUSES },
            },
          },
          { $unwind: '$items' },
          {
            $group: {
              _id: {
                $ifNull: [
                  { $toString: '$items.entityId' },
                  { $concat: ['label:', '$items.label'] },
                ],
              },
              label: { $first: '$items.label' },
              count: { $sum: '$items.quantity' },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 8 },
        ])
        .exec(),
    ]);

    const productIds = new Set<string>();
    const storeIds = new Set<string>();

    for (const pid of digest?.topViewedProductIds ?? []) {
      if (Types.ObjectId.isValid(pid)) productIds.add(String(pid));
    }
    for (const sid of digest?.topViewedStoreIds ?? []) {
      if (Types.ObjectId.isValid(sid)) storeIds.add(String(sid));
    }
    for (const sig of recentSignals) {
      if (sig.kind === UserRecommendationSignalKind.PRODUCT_VIEW) {
        productIds.add(String(sig.refId));
      } else if (sig.kind === UserRecommendationSignalKind.STORE_VIEW) {
        storeIds.add(String(sig.refId));
      }
    }

    const [products, stores] = await Promise.all([
      productIds.size
        ? this.productModel
            .find({ _id: { $in: [...productIds].map((x) => new Types.ObjectId(x)) } })
            .select('title store')
            .populate('store', 'name')
            .lean()
            .exec()
        : Promise.resolve([]),
      storeIds.size
        ? this.storeModel
            .find({ _id: { $in: [...storeIds].map((x) => new Types.ObjectId(x)) } })
            .select('name')
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);

    const productById = new Map(
      products.map((p) => {
        const store = p.store as { name?: string } | Types.ObjectId | null;
        const storeName =
          store && typeof store === 'object' && 'name' in store
            ? String(store.name ?? '')
            : null;
        return [
          String(p._id),
          {
            id: String(p._id),
            title: String(p.title ?? ''),
            storeName: storeName?.trim() ? storeName : null,
          },
        ];
      }),
    );
    const storeById = new Map(
      stores.map((s) => [
        String(s._id),
        { id: String(s._id), name: String(s.name ?? '') },
      ]),
    );

    const topViewedProducts = (digest?.topViewedProductIds ?? [])
      .map((pid) => productById.get(String(pid)))
      .filter((x): x is NonNullable<typeof x> => !!x);

    const topViewedStores = (digest?.topViewedStoreIds ?? [])
      .map((sid) => storeById.get(String(sid)))
      .filter((x): x is NonNullable<typeof x> => !!x);

    const recentSignalRows = recentSignals.map((sig) => {
      const refId = String(sig.refId);
      let label = refId;
      if (sig.kind === UserRecommendationSignalKind.PRODUCT_VIEW) {
        label = productById.get(refId)?.title ?? 'Produit inconnu';
      } else if (sig.kind === UserRecommendationSignalKind.STORE_VIEW) {
        label = storeById.get(refId)?.name ?? 'Boutique inconnue';
      } else if (sig.kind === UserRecommendationSignalKind.SEARCH_QUERY) {
        label = String(sig.searchTerm ?? 'Recherche');
      }
      return {
        kind: sig.kind,
        label,
        searchTerm:
          sig.kind === UserRecommendationSignalKind.SEARCH_QUERY
            ? String(sig.searchTerm ?? '')
            : null,
        createdAt:
          sig.createdAt instanceof Date ? sig.createdAt.toISOString() : null,
      };
    });

    const stats = orderStats[0];

    return {
      user: {
        id,
        fullName: String(userDoc.fullName ?? ''),
        email: String(userDoc.email ?? ''),
        type: String(userDoc.type ?? UserTypeEnum.USER),
        appCountryCode:
          typeof userDoc.appCountryCode === 'string'
            ? userDoc.appCountryCode
            : null,
      },
      adsTargeting: adsProfile
        ? {
            segment: String(adsProfile.segment ?? 'new_user'),
            topCategories: (adsProfile.topCategories ?? []).map(String),
            interestScores: (adsProfile.interestScores ?? {}) as Record<
              string,
              number
            >,
            engagementRate: Number(adsProfile.engagementRate ?? 0),
            conversionProbability: Number(
              adsProfile.conversionProbability ?? 0,
            ),
            sessions30d: Number(adsProfile.sessions30d ?? 0),
            lastActive:
              adsProfile.lastActive instanceof Date
                ? adsProfile.lastActive.toISOString()
                : null,
            lastComputedAt:
              adsProfile.lastComputedAt instanceof Date
                ? adsProfile.lastComputedAt.toISOString()
                : null,
            country:
              typeof adsProfile.country === 'string'
                ? adsProfile.country
                : null,
            language:
              typeof adsProfile.language === 'string'
                ? adsProfile.language
                : null,
          }
        : null,
      recommendationDigest: digest
        ? {
            computedAt:
              digest.computedAt instanceof Date
                ? digest.computedAt.toISOString()
                : null,
            topSearchTerms: (digest.topSearchTerms ?? []).map(String),
          }
        : null,
      topViewedProducts,
      topViewedStores,
      recentSignals: recentSignalRows,
      orderInsights: {
        totalOrders: Number(stats?.total ?? 0),
        lastOrderAt:
          stats?.lastOrderAt instanceof Date
            ? stats.lastOrderAt.toISOString()
            : null,
        topCategories: topCategoryRows.map((row) => ({
          category: String(row._id ?? ''),
          count: Number(row.count ?? 0),
        })),
        topProducts: topProductRows.map((row) => ({
          entityId: String(row._id ?? '').startsWith('label:')
            ? null
            : String(row._id ?? ''),
          label: String(row.label ?? ''),
          count: Number(row.count ?? 0),
        })),
      },
    };
  }
}
