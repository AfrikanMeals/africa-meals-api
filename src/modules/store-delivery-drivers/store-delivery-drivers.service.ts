import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import {
  StoreDeliveryDriverMembershipModel,
  StoreDeliveryDriverMembershipStatus,
} from '@schemas/store-delivery-driver-membership.schema';
import {
  StoreDeliveryAssignmentModeEnum,
  StoreModel,
} from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import type {
  DeliveryDriverStorePartnerRowDto,
  DeliveryDriverStorePartnersListResponseDto,
  StoreDeliveryDriverRowDto,
  StoreDeliveryDriversListResponseDto,
} from './dto/store-delivery-drivers.dto';
import { buildStoreDeliveryDriverInviteAcceptUrl } from './store-delivery-driver-invite-url.util';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';

const DELIVERED_STATUSES = [
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.COMPLETED,
];

@Injectable()
export class StoreDeliveryDriversService {
  @InjectModel(StoreDeliveryDriverMembershipModel.name)
  private readonly _membershipModel: Model<StoreDeliveryDriverMembershipModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @InjectModel(DeliveryAgentApplicationModel.name)
  private readonly _applicationModel: Model<DeliveryAgentApplicationModel>;

  @Inject(ConfigService)
  private readonly _config: ConfigService;

  @Inject(MailerService)
  private readonly _mailer: MailerService;

  @Inject(EmailTemplateService)
  private readonly _emailTpl: EmailTemplateService;

  @Inject(SubscriptionsService)
  private readonly _subscriptions: SubscriptionsService;

  async assertStoreOwner(user: UserModel, storeId: string): Promise<StoreModel> {
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException('invalid_store_id');
    }
    const store = await this._storeModel.findById(storeId).exec();
    if (!store) throw new NotFoundException('store_not_found');
    const ownerId = String(store.owner ?? '');
    const userId = String(user._id ?? user.id ?? '');
    if (user.type !== UserTypeEnum.ADMIN && ownerId !== userId) {
      throw new ForbiddenException('store_forbidden');
    }
    return store;
  }

  async resolveOwnerStore(user: UserModel): Promise<StoreModel> {
    const store = await this._storeModel.findOne({ owner: user._id }).exec();
    if (!store) throw new NotFoundException('store_not_found');
    return store;
  }

  isStoreManagedDelivery(store: unknown): boolean {
    if (!store || typeof store !== 'object') return false;
    const doc = store as Record<string, unknown>;
    return !!doc.vendorManagesDeliveryDrivers;
  }

  storeAssignmentMode(store: unknown): StoreDeliveryAssignmentModeEnum {
    if (!store || typeof store !== 'object') {
      return StoreDeliveryAssignmentModeEnum.AUTO;
    }
    const raw = String(
      (store as Record<string, unknown>).deliveryAssignmentMode ?? 'AUTO',
    ).toUpperCase();
    return raw === StoreDeliveryAssignmentModeEnum.MANUAL
      ? StoreDeliveryAssignmentModeEnum.MANUAL
      : StoreDeliveryAssignmentModeEnum.AUTO;
  }

  private async _assertDeliveryAgentSlotAvailable(storeId: string): Promise<void> {
    const limit = await this._subscriptions.resolveMaxDeliveryAgentsForStore(
      storeId,
    );
    if (limit <= 0) return;
    const count = await this._membershipModel
      .countDocuments({
        store: new Types.ObjectId(storeId),
        status: {
          $in: [
            StoreDeliveryDriverMembershipStatus.ACTIVE,
            StoreDeliveryDriverMembershipStatus.PENDING,
          ],
        },
      })
      .exec();
    if (count >= limit) {
      throw new BadRequestException('store_delivery_agents_limit_reached');
    }
  }

  async isActiveStoreDriver(
    storeId: string,
    deliveryUserId: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(storeId) || !Types.ObjectId.isValid(deliveryUserId)) {
      return false;
    }
    const row = await this._membershipModel
      .findOne({
        store: new Types.ObjectId(storeId),
        user: new Types.ObjectId(deliveryUserId),
        status: StoreDeliveryDriverMembershipStatus.ACTIVE,
      })
      .select('_id')
      .lean()
      .exec();
    return !!row;
  }

  async listActiveDriverUserIdsForStore(storeId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(storeId)) return [];
    const rows = await this._membershipModel
      .find({
        store: new Types.ObjectId(storeId),
        status: StoreDeliveryDriverMembershipStatus.ACTIVE,
        user: { $exists: true, $ne: null },
      })
      .select('user')
      .lean()
      .exec();
    return rows
      .map((r) => String((r as { user?: unknown }).user ?? ''))
      .filter((id) => Types.ObjectId.isValid(id));
  }

  async listStoreIdsForActiveDriver(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const rows = await this._membershipModel
      .find({
        user: new Types.ObjectId(userId),
        status: StoreDeliveryDriverMembershipStatus.ACTIVE,
      })
      .select('store')
      .lean()
      .exec();
    return rows
      .map((r) => String((r as { store?: unknown }).store ?? ''))
      .filter((id) => Types.ObjectId.isValid(id));
  }

  /** Boutiques où le livreur est membre actif de la flotte restaurant. */
  async listActivePartnersForDriver(
    userId: string,
  ): Promise<DeliveryDriverStorePartnersListResponseDto> {
    if (!Types.ObjectId.isValid(userId)) return { items: [] };
    const userOid = new Types.ObjectId(userId);

    const memberships = await this._membershipModel
      .find({
        user: userOid,
        status: StoreDeliveryDriverMembershipStatus.ACTIVE,
      })
      .sort({ respondedAt: -1, invitedAt: -1 })
      .lean()
      .exec();
    if (!memberships.length) return { items: [] };

    const storeIds = [
      ...new Set(
        memberships
          .map((m) => String((m as { store?: unknown }).store ?? ''))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const stores =
      storeIds.length > 0
        ? await this._storeModel
            .find({
              _id: { $in: storeIds.map((id) => new Types.ObjectId(id)) },
              vendorManagesDeliveryDrivers: true,
            })
            .select(
              'name profileImage currency deliveryAssignmentMode vendorManagesDeliveryDrivers',
            )
            .lean()
            .exec()
        : [];
    const storeMap = new Map(stores.map((s) => [String(s._id), s]));

    const statsByStore = new Map<
      string,
      {
        total: number;
        today: number;
        revenueTotal: number;
        revenueToday: number;
        abandonsTotal: number;
        abandonsToday: number;
        vendorUnassignsTotal: number;
        vendorUnassignsToday: number;
      }
    >();
    await Promise.all(
      storeIds.map(async (sid) => {
        const stats = await this._aggregateDriverPerformanceStats(sid, [userOid]);
        statsByStore.set(sid, stats.get(userId) ?? {
          total: 0,
          today: 0,
          revenueTotal: 0,
          revenueToday: 0,
          abandonsTotal: 0,
          abandonsToday: 0,
          vendorUnassignsTotal: 0,
          vendorUnassignsToday: 0,
        });
      }),
    );

    const items: DeliveryDriverStorePartnerRowDto[] = [];
    for (const m of memberships) {
      const doc = m as Record<string, unknown>;
      const sid = String(doc.store ?? '');
      const store = storeMap.get(sid);
      if (!store) continue;
      const stats = statsByStore.get(sid) ?? {
        total: 0,
        today: 0,
        revenueTotal: 0,
        revenueToday: 0,
        abandonsTotal: 0,
        abandonsToday: 0,
        vendorUnassignsTotal: 0,
        vendorUnassignsToday: 0,
      };
      items.push({
        membershipId: String(doc._id),
        storeId: sid,
        storeName: String(store.name ?? 'Restaurant'),
        storeProfileImage: store.profileImage
          ? String(store.profileImage)
          : undefined,
        storeCurrency: store.currency ? String(store.currency) : undefined,
        deliveryAssignmentMode:
          store.deliveryAssignmentMode ??
          StoreDeliveryAssignmentModeEnum.AUTO,
        joinedAt: doc.respondedAt
          ? new Date(String(doc.respondedAt)).toISOString()
          : doc.invitedAt
            ? new Date(String(doc.invitedAt)).toISOString()
            : undefined,
        ordersDelivered: stats.total,
        ordersDeliveredToday: stats.today,
        deliveryRevenueTotal: stats.revenueTotal,
        deliveryRevenueToday: stats.revenueToday,
        courierAbandonsTotal: stats.abandonsTotal,
        courierAbandonsToday: stats.abandonsToday,
        vendorUnassignsTotal: stats.vendorUnassignsTotal,
        vendorUnassignsToday: stats.vendorUnassignsToday,
      });
    }

    return { items };
  }

  async listForVendor(
    user: UserModel,
    storeId?: string,
  ): Promise<StoreDeliveryDriversListResponseDto> {
    const store = storeId
      ? await this.assertStoreOwner(user, storeId)
      : await this.resolveOwnerStore(user);
    const sid = String(store._id);
    const memberships = await this._membershipModel
      .find({ store: store._id })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const userIds = memberships
      .map((m) => (m as { user?: unknown }).user)
      .filter((u) => u && Types.ObjectId.isValid(String(u)))
      .map((u) => new Types.ObjectId(String(u)));

    const users =
      userIds.length > 0
        ? await this._userModel
            .find({ _id: { $in: userIds } })
            .select('fullName email phoneNumber profileImage')
            .lean()
            .exec()
        : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const statsByUser = await this._aggregateDriverPerformanceStats(sid, userIds);

    const items: StoreDeliveryDriverRowDto[] = memberships.map((m) => {
      const doc = m as Record<string, unknown>;
      const uid = doc.user ? String(doc.user) : '';
      const u = uid ? userMap.get(uid) : undefined;
      const stats = uid ? statsByUser.get(uid) : undefined;
      return {
        id: String(doc._id),
        email: String(doc.email ?? ''),
        userId: uid || undefined,
        fullName: u?.fullName ? String(u.fullName) : undefined,
        phoneNumber: u?.phoneNumber ? String(u.phoneNumber) : undefined,
        status: String(doc.status ?? ''),
        invitedAt: doc.invitedAt
          ? new Date(String(doc.invitedAt)).toISOString()
          : undefined,
        respondedAt: doc.respondedAt
          ? new Date(String(doc.respondedAt)).toISOString()
          : undefined,
        ordersDelivered: stats?.total ?? 0,
        ordersDeliveredToday: stats?.today ?? 0,
        deliveryRevenueTotal: stats?.revenueTotal ?? 0,
        deliveryRevenueToday: stats?.revenueToday ?? 0,
        courierAbandonsTotal: stats?.abandonsTotal ?? 0,
        courierAbandonsToday: stats?.abandonsToday ?? 0,
        vendorUnassignsTotal: stats?.vendorUnassignsTotal ?? 0,
        vendorUnassignsToday: stats?.vendorUnassignsToday ?? 0,
      };
    });

    return {
      storeId: sid,
      storeName: String(store.name ?? ''),
      vendorManagesDeliveryDrivers: !!store.vendorManagesDeliveryDrivers,
      deliveryAssignmentMode:
        store.deliveryAssignmentMode ?? StoreDeliveryAssignmentModeEnum.AUTO,
      items,
    };
  }

  private async _aggregateDriverPerformanceStats(
    storeId: string,
    userIds: Types.ObjectId[],
  ): Promise<
    Map<
      string,
      {
        total: number;
        today: number;
        revenueTotal: number;
        revenueToday: number;
        abandonsTotal: number;
        abandonsToday: number;
        vendorUnassignsTotal: number;
        vendorUnassignsToday: number;
      }
    >
  > {
    const out = new Map<
      string,
      {
        total: number;
        today: number;
        revenueTotal: number;
        revenueToday: number;
        abandonsTotal: number;
        abandonsToday: number;
        vendorUnassignsTotal: number;
        vendorUnassignsToday: number;
      }
    >();
    if (!userIds.length) return out;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const storeOid = new Types.ObjectId(storeId);

    const [deliveredRows, abandonRows, vendorUnassignRows] = await Promise.all([
      this._orderModel
        .aggregate([
          {
            $match: {
              store: storeOid,
              shouldShip: true,
              assignedDeliveryUser: { $in: userIds },
              status: { $in: DELIVERED_STATUSES },
            },
          },
          {
            $group: {
              _id: '$assignedDeliveryUser',
              total: { $sum: 1 },
              revenueTotal: { $sum: { $ifNull: ['$shippingPrice', 0] } },
              today: {
                $sum: {
                  $cond: [{ $gte: ['$updatedAt', startOfDay] }, 1, 0],
                },
              },
              revenueToday: {
                $sum: {
                  $cond: [
                    { $gte: ['$updatedAt', startOfDay] },
                    { $ifNull: ['$shipping_price', 0] },
                    0,
                  ],
                },
              },
            },
          },
        ])
        .exec(),
      this._orderModel
        .aggregate([
          {
            $match: {
              store: storeOid,
              shouldShip: true,
              deliveryUnassignedFromUser: { $in: userIds },
              deliveryUnassignReason: 'courier_abandon',
            },
          },
          {
            $group: {
              _id: '$deliveryUnassignedFromUser',
              abandonsTotal: { $sum: 1 },
              abandonsToday: {
                $sum: {
                  $cond: [{ $gte: ['$deliveryUnassignedAt', startOfDay] }, 1, 0],
                },
              },
            },
          },
        ])
        .exec(),
      this._orderModel
        .aggregate([
          {
            $match: {
              store: storeOid,
              shouldShip: true,
              deliveryUnassignedFromUser: { $in: userIds },
              deliveryUnassignReason: { $in: ['vendor_unassign', 'admin_unassign'] },
            },
          },
          {
            $group: {
              _id: '$deliveryUnassignedFromUser',
              vendorUnassignsTotal: { $sum: 1 },
              vendorUnassignsToday: {
                $sum: {
                  $cond: [{ $gte: ['$deliveryUnassignedAt', startOfDay] }, 1, 0],
                },
              },
            },
          },
        ])
        .exec(),
    ]);

    for (const uid of userIds) {
      out.set(String(uid), {
        total: 0,
        today: 0,
        revenueTotal: 0,
        revenueToday: 0,
        abandonsTotal: 0,
        abandonsToday: 0,
        vendorUnassignsTotal: 0,
        vendorUnassignsToday: 0,
      });
    }

    for (const row of deliveredRows) {
      const id = String(row._id ?? '');
      if (!id) continue;
      const cur = out.get(id) ?? {
        total: 0,
        today: 0,
        revenueTotal: 0,
        revenueToday: 0,
        abandonsTotal: 0,
        abandonsToday: 0,
        vendorUnassignsTotal: 0,
        vendorUnassignsToday: 0,
      };
      out.set(id, {
        ...cur,
        total: Number(row.total ?? 0),
        today: Number(row.today ?? 0),
        revenueTotal: Math.round(Number(row.revenueTotal ?? 0) * 100) / 100,
        revenueToday: Math.round(Number(row.revenueToday ?? 0) * 100) / 100,
      });
    }
    for (const row of abandonRows) {
      const id = String(row._id ?? '');
      if (!id) continue;
      const cur = out.get(id) ?? {
        total: 0,
        today: 0,
        revenueTotal: 0,
        revenueToday: 0,
        abandonsTotal: 0,
        abandonsToday: 0,
        vendorUnassignsTotal: 0,
        vendorUnassignsToday: 0,
      };
      out.set(id, {
        ...cur,
        abandonsTotal: Number(row.abandonsTotal ?? 0),
        abandonsToday: Number(row.abandonsToday ?? 0),
      });
    }
    for (const row of vendorUnassignRows) {
      const id = String(row._id ?? '');
      if (!id) continue;
      const cur = out.get(id) ?? {
        total: 0,
        today: 0,
        revenueTotal: 0,
        revenueToday: 0,
        abandonsTotal: 0,
        abandonsToday: 0,
        vendorUnassignsTotal: 0,
        vendorUnassignsToday: 0,
      };
      out.set(id, {
        ...cur,
        vendorUnassignsTotal: Number(row.vendorUnassignsTotal ?? 0),
        vendorUnassignsToday: Number(row.vendorUnassignsToday ?? 0),
      });
    }
    return out;
  }

  /** @deprecated use _aggregateDriverPerformanceStats */
  private async _aggregateDriverStats(
    storeId: string,
    userIds: Types.ObjectId[],
  ): Promise<
    Map<
      string,
      { total: number; today: number; revenueTotal: number; revenueToday: number }
    >
  > {
    const perf = await this._aggregateDriverPerformanceStats(storeId, userIds);
    const out = new Map<
      string,
      { total: number; today: number; revenueTotal: number; revenueToday: number }
    >();
    for (const [id, stats] of perf) {
      out.set(id, {
        total: stats.total,
        today: stats.today,
        revenueTotal: stats.revenueTotal,
        revenueToday: stats.revenueToday,
      });
    }
    return out;
  }

  async inviteByEmail(
    user: UserModel,
    emailRaw: string,
    storeId?: string,
  ): Promise<StoreDeliveryDriverRowDto> {
    const store = storeId
      ? await this.assertStoreOwner(user, storeId)
      : await this.resolveOwnerStore(user);
    if (!store.supportsShipping) {
      throw new BadRequestException('store_shipping_disabled');
    }
    if (!store.vendorManagesDeliveryDrivers) {
      throw new BadRequestException('store_delivery_drivers_not_enabled');
    }
    await this._assertDeliveryAgentSlotAvailable(String(store._id));

    const email = emailRaw.trim().toLowerCase();
    if (!email) throw new BadRequestException('invalid_email');

    const approvedAgent =
      await this._resolveApprovedDeliveryAgentByEmail(email);

    const existing = await this._membershipModel
      .findOne({ store: store._id, email })
      .exec();
    if (
      existing &&
      existing.status !== StoreDeliveryDriverMembershipStatus.REVOKED &&
      existing.status !== StoreDeliveryDriverMembershipStatus.DECLINED
    ) {
      throw new ConflictException('store_driver_already_invited');
    }

    const token = randomUUID().replace(/-/g, '');
    const invitedBy = new Types.ObjectId(String(user._id ?? user.id));

    let membership: StoreDeliveryDriverMembershipModel;
    if (existing) {
      existing.status = StoreDeliveryDriverMembershipStatus.PENDING;
      existing.inviteToken = token;
      existing.invitedBy = invitedBy as unknown as StoreDeliveryDriverMembershipModel['invitedBy'];
      existing.invitedAt = new Date();
      existing.respondedAt = undefined;
      existing.user = approvedAgent._id as unknown as StoreDeliveryDriverMembershipModel['user'];
      await existing.save();
      membership = existing;
    } else {
      membership = await this._membershipModel.create({
        store: store._id,
        email,
        user: approvedAgent._id,
        status: StoreDeliveryDriverMembershipStatus.PENDING,
        inviteToken: token,
        invitedBy,
        invitedAt: new Date(),
      });
    }

    await this._sendInviteEmail({
      email,
      storeName: String(store.name ?? 'Restaurant'),
      token,
      recipientName: approvedAgent.fullName ?? email,
    });

    const list = await this.listForVendor(user, String(store._id));
    const row = list.items.find((i) => i.id === String(membership._id));
    if (!row) {
      return {
        id: String(membership._id),
        email,
        status: StoreDeliveryDriverMembershipStatus.PENDING,
        ordersDelivered: 0,
        ordersDeliveredToday: 0,
        deliveryRevenueTotal: 0,
        deliveryRevenueToday: 0,
        courierAbandonsTotal: 0,
        courierAbandonsToday: 0,
        vendorUnassignsTotal: 0,
        vendorUnassignsToday: 0,
      };
    }
    return row;
  }

  async revokeMembership(
    user: UserModel,
    membershipId: string,
  ): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(membershipId)) {
      throw new BadRequestException('invalid_id');
    }
    const membership = await this._membershipModel.findById(membershipId).exec();
    if (!membership) throw new NotFoundException('membership_not_found');
    await this.assertStoreOwner(user, String(membership.store));
    membership.status = StoreDeliveryDriverMembershipStatus.REVOKED;
    membership.inviteToken = undefined;
    membership.respondedAt = new Date();
    await membership.save();
    return { ok: true };
  }

  async resendInvite(
    user: UserModel,
    membershipId: string,
  ): Promise<StoreDeliveryDriverRowDto> {
    if (!Types.ObjectId.isValid(membershipId)) {
      throw new BadRequestException('invalid_id');
    }
    const membership = await this._membershipModel.findById(membershipId).exec();
    if (!membership) throw new NotFoundException('membership_not_found');
    const store = await this.assertStoreOwner(user, String(membership.store));
    if (membership.status !== StoreDeliveryDriverMembershipStatus.PENDING) {
      throw new BadRequestException('invite_not_pending');
    }
    await this._resolveApprovedDeliveryAgentByEmail(membership.email);
    const token = randomUUID().replace(/-/g, '');
    membership.inviteToken = token;
    membership.invitedAt = new Date();
    await membership.save();

    const linked = membership.user
      ? await this._userModel
          .findById(membership.user)
          .select('fullName')
          .lean()
          .exec()
      : null;

    await this._sendInviteEmail({
      email: membership.email,
      storeName: String(store.name ?? 'Restaurant'),
      token,
      recipientName: linked?.fullName
        ? String(linked.fullName)
        : membership.email,
    });

    const list = await this.listForVendor(user, String(store._id));
    return (
      list.items.find((i) => i.id === membershipId) ?? {
        id: membershipId,
        email: membership.email,
        status: membership.status,
        ordersDelivered: 0,
        ordersDeliveredToday: 0,
        deliveryRevenueTotal: 0,
        deliveryRevenueToday: 0,
        courierAbandonsTotal: 0,
        courierAbandonsToday: 0,
        vendorUnassignsTotal: 0,
        vendorUnassignsToday: 0,
      }
    );
  }

  async previewInvite(
    token: string,
  ): Promise<{ valid: true; storeId: string; storeName: string }> {
    const normalized = token.trim();
    if (!normalized) throw new BadRequestException('invalid_token');

    const membership = await this._membershipModel
      .findOne({
        inviteToken: normalized,
        status: StoreDeliveryDriverMembershipStatus.PENDING,
      })
      .exec();
    if (!membership) throw new NotFoundException('invite_not_found');

    const store = await this._storeModel
      .findById(membership.store)
      .select('name vendorManagesDeliveryDrivers')
      .exec();
    if (!store?.vendorManagesDeliveryDrivers) {
      throw new BadRequestException('store_delivery_drivers_not_enabled');
    }

    return {
      valid: true,
      storeId: String(store._id),
      storeName: String(store.name ?? 'Restaurant'),
    };
  }

  /** Acceptation via lien e-mail (sans connexion app / JWT). */
  async acceptInviteByToken(
    token: string,
  ): Promise<{ ok: true; storeId: string; storeName: string }> {
    const normalized = token.trim();
    if (!normalized) throw new BadRequestException('invalid_token');

    const membership = await this._membershipModel
      .findOne({
        inviteToken: normalized,
        status: StoreDeliveryDriverMembershipStatus.PENDING,
      })
      .exec();
    if (!membership) throw new NotFoundException('invite_not_found');

    const userOid = await this._resolveInviteAcceptanceUser(membership);
    return this._finalizeInviteAcceptance(membership, normalized, userOid);
  }

  async acceptInvite(user: UserModel, token: string): Promise<{ ok: true; storeId: string; storeName: string }> {
    const normalized = token.trim();
    if (!normalized) throw new BadRequestException('invalid_token');

    const membership = await this._membershipModel
      .findOne({
        inviteToken: normalized,
        status: StoreDeliveryDriverMembershipStatus.PENDING,
      })
      .exec();
    if (!membership) throw new NotFoundException('invite_not_found');

    const userEmail = String(user.email ?? '')
      .trim()
      .toLowerCase();
    if (userEmail !== membership.email) {
      throw new ForbiddenException('invite_email_mismatch');
    }

    await this._assertApprovedDeliveryAgentUser(user);

    const userOid = new Types.ObjectId(String(user._id ?? user.id));
    return this._finalizeInviteAcceptance(membership, normalized, userOid);
  }

  async declineInvite(user: UserModel, token: string): Promise<{ ok: true }> {
    const normalized = token.trim();
    if (!normalized) throw new BadRequestException('invalid_token');
    const membership = await this._membershipModel
      .findOne({
        inviteToken: normalized,
        status: StoreDeliveryDriverMembershipStatus.PENDING,
      })
      .exec();
    if (!membership) throw new NotFoundException('invite_not_found');
    const userEmail = String(user.email ?? '')
      .trim()
      .toLowerCase();
    if (userEmail !== membership.email) {
      throw new ForbiddenException('invite_email_mismatch');
    }
    membership.status = StoreDeliveryDriverMembershipStatus.DECLINED;
    membership.inviteToken = undefined;
    membership.respondedAt = new Date();
    await membership.save();
    return { ok: true };
  }

  async listPendingInvitesForUser(
    user: UserModel,
  ): Promise<
    Array<{
      membershipId: string;
      storeId: string;
      storeName: string;
      invitedAt?: string;
    }>
  > {
    const email = String(user.email ?? '')
      .trim()
      .toLowerCase();
    if (!email) return [];
    const rows = await this._membershipModel
      .find({
        email,
        status: StoreDeliveryDriverMembershipStatus.PENDING,
      })
      .sort({ invitedAt: -1 })
      .lean()
      .exec();
    const storeIds = [
      ...new Set(
        rows
          .map((r) => String((r as { store?: unknown }).store ?? ''))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const stores =
      storeIds.length > 0
        ? await this._storeModel
            .find({ _id: { $in: storeIds.map((id) => new Types.ObjectId(id)) } })
            .select('name')
            .lean()
            .exec()
        : [];
    const storeMap = new Map(stores.map((s) => [String(s._id), s]));

    return rows.map((r) => {
      const doc = r as Record<string, unknown>;
      const sid = String(doc.store ?? '');
      const st = storeMap.get(sid);
      return {
        membershipId: String(doc._id),
        storeId: sid,
        storeName: st?.name ? String(st.name) : 'Restaurant',
        invitedAt: doc.invitedAt
          ? new Date(String(doc.invitedAt)).toISOString()
          : undefined,
        token: doc.inviteToken ? String(doc.inviteToken) : undefined,
      };
    });
  }

  /** Livreur plateforme approuvé (type DELIVERY + candidature APPROVED). */
  private async _resolveInviteAcceptanceUser(
    membership: StoreDeliveryDriverMembershipModel,
  ): Promise<Types.ObjectId> {
    if (membership.user) {
      const linked = await this._userModel.findById(membership.user).exec();
      if (!linked) {
        throw new BadRequestException('store_driver_user_not_found');
      }
      await this._assertApprovedDeliveryAgentUser(linked);
      return new Types.ObjectId(String(linked._id ?? linked.id));
    }

    const agent = await this._resolveApprovedDeliveryAgentByEmail(membership.email);
    return agent._id;
  }

  private async _finalizeInviteAcceptance(
    membership: StoreDeliveryDriverMembershipModel,
    inviteToken: string,
    userOid: Types.ObjectId,
  ): Promise<{ ok: true; storeId: string; storeName: string }> {
    const store = await this._storeModel
      .findById(membership.store)
      .select('name vendorManagesDeliveryDrivers')
      .exec();
    if (!store?.vendorManagesDeliveryDrivers) {
      throw new BadRequestException('store_delivery_drivers_not_enabled');
    }
    await this._assertDeliveryAgentSlotAvailable(String(store._id));

    const updated = await this._membershipModel
      .findOneAndUpdate(
        {
          _id: membership._id,
          inviteToken,
          status: StoreDeliveryDriverMembershipStatus.PENDING,
        },
        {
          $set: {
            status: StoreDeliveryDriverMembershipStatus.ACTIVE,
            user: userOid,
            respondedAt: new Date(),
          },
          $unset: { inviteToken: '' },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('invite_not_found');

    return {
      ok: true,
      storeId: String(store._id),
      storeName: String(store.name ?? ''),
    };
  }

  private async _resolveApprovedDeliveryAgentByEmail(email: string): Promise<{
    _id: Types.ObjectId;
    fullName?: string;
  }> {
    const linkedUser = await this._userModel
      .findOne({ email: email.trim().toLowerCase() })
      .select('_id fullName type')
      .lean()
      .exec();
    if (!linkedUser?._id) {
      throw new BadRequestException('store_driver_user_not_found');
    }
    if (linkedUser.type !== UserTypeEnum.DELIVERY) {
      throw new BadRequestException('store_driver_not_approved_agent');
    }
    const app = await this._applicationModel
      .findOne({
        user: linkedUser._id,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .select('_id')
      .lean()
      .exec();
    if (!app) {
      throw new BadRequestException('store_driver_not_approved_agent');
    }
    return {
      _id: linkedUser._id as Types.ObjectId,
      fullName: linkedUser.fullName ? String(linkedUser.fullName) : undefined,
    };
  }

  private async _assertApprovedDeliveryAgentUser(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.DELIVERY) {
      throw new ForbiddenException('store_driver_not_approved_agent');
    }
    const userOid = new Types.ObjectId(String(user._id ?? user.id));
    const app = await this._applicationModel
      .findOne({
        user: userOid,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .select('_id')
      .lean()
      .exec();
    if (!app) {
      throw new ForbiddenException('store_driver_not_approved_agent');
    }
  }

  private _buildInviteAcceptUrl(token: string): string {
    return buildStoreDeliveryDriverInviteAcceptUrl(
      (key) => this._config.get<string>(key),
      token,
    );
  }

  private _escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private async _sendInviteEmail(args: {
    email: string;
    storeName: string;
    token: string;
    recipientName: string;
  }): Promise<void> {
    const appName = this._config.get<string>('APP_NAME') ?? 'Wise Eat';
    const acceptUrl = this._buildInviteAcceptUrl(args.token);
    const safeStore = this._escapeHtml(args.storeName);
    const safeName = this._escapeHtml(args.recipientName);
    const safeApp = this._escapeHtml(appName);

    const html = [
      this._emailTpl.heading('Invitation livreur'),
      this._emailTpl.paragraph(`Bonjour <strong>${safeName}</strong>,`),
      this._emailTpl.paragraph(
        `<strong>${safeStore}</strong> vous invite à rejoindre son équipe de livraison sur <strong>${safeApp}</strong>.`,
      ),
      this._emailTpl.paragraph(
        'Seuls les livreurs déjà approuvés par la plateforme peuvent rejoindre cette équipe.',
      ),
      this._emailTpl.paragraph(
        'Cliquez sur le bouton ci-dessous pour accepter l’invitation — aucune ouverture d’application requise.',
      ),
      this._emailTpl.button('Accepter l’invitation', acceptUrl),
      this._emailTpl.muted(
        `Lien direct : <span style="word-break:break-all;">${this._escapeHtml(acceptUrl)}</span>`,
      ),
    ].join('\n');

    const text = [
      `Bonjour ${args.recipientName},`,
      ``,
      `${args.storeName} vous invite à rejoindre son équipe de livraison sur ${appName}.`,
      `Accepter : ${acceptUrl}`,
    ].join('\n');

    await this._mailer.sendSimple({
      to: args.email,
      toName: args.recipientName,
      subject: `${appName} — Invitation livreur (${args.storeName})`,
      html,
      text,
    });
  }
}
