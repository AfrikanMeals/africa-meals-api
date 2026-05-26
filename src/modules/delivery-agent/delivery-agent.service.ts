import { MailerService } from '@modules/mailer/mailer.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { OrderStatusEventsService } from '@modules/orders/order-status-events.service';
import { OrdersService } from '@modules/orders/orders.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { OrderStatusChangeSourceEnum } from '@schemas/order-status-event.schema';
import {
  OrderModel,
  OrderStatusEnum,
} from '@schemas/order.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { haversineDistance } from 'src/utils/helpers';
import { StripeConnectService } from '@modules/billing/stripe/stripe-connect.service';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import { PatchDeliveryAgentApplicationDto } from './dto/delivery-agent-application.dto';
import { DeliveryAgentLocationDto } from './dto/delivery-agent-location.dto';
import {
  defaultDeliveryCapacity,
  driverLicenseRequired,
  normalizeVehicleRegistration,
  vehicleRegistrationRequired,
} from './delivery-agent-vehicle.util';

type LeanApp = {
  status: DeliveryAgentApplicationStatus;
  onboardingStep: number;
  vehicle?: string;
  vehicleRegistration?: string;
  driverLicense?: string;
  maxConcurrentOrders?: number;
  serviceZone?: string;
  termsAccepted: boolean;
  submittedAt?: Date;
  rejectionReason?: string;
  updatedAt?: Date;
};

const APPLICATION_PUBLIC_SELECT =
  'status onboardingStep vehicle vehicleRegistration driverLicense maxConcurrentOrders serviceZone termsAccepted submittedAt rejectionReason updatedAt';

type LeanAppDoc = LeanApp & {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  createdAt?: Date;
};

@Injectable()
export class DeliveryAgentService {
  private readonly _logger = new Logger(DeliveryAgentService.name);

  @InjectModel(DeliveryAgentApplicationModel.name)
  private readonly _applications: Model<DeliveryAgentApplicationModel>;

  @InjectModel(UserModel.name)
  private readonly _users: Model<UserModel>;

  @InjectModel(OrderModel.name)
  private readonly _orders: Model<OrderModel>;

  constructor(
    @Inject(NotificationsService)
    private readonly _notifications: NotificationsService,
    @Inject(MailerService)
    private readonly _mailer: MailerService,
    private readonly _config: ConfigService,
    @Inject(PlatformShippingSettingsService)
    private readonly _platformShipping: PlatformShippingSettingsService,
    @Inject(StripeConnectService)
    private readonly _stripeConnect: StripeConnectService,
    @Inject(OrderStatusEventsService)
    private readonly _orderStatusEvents: OrderStatusEventsService,
    @Inject(OrdersService)
    private readonly _ordersService: OrdersService,
  ) {}

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  assertEligible(user: UserModel) {
    if (
      user.type === UserTypeEnum.VENDOR ||
      user.type === UserTypeEnum.ADMIN
    ) {
      throw new ForbiddenException('delivery_agent_not_available_for_account');
    }
  }

  toPublic(doc: LeanApp | null) {
    if (!doc) {
      return {
        status: DeliveryAgentApplicationStatus.DRAFT,
        onboardingStep: 0,
        vehicle: null as string | null,
        vehicleRegistration: null as string | null,
        driverLicense: null as string | null,
        maxConcurrentOrders: null as number | null,
        serviceZone: null as string | null,
        termsAccepted: false,
        submittedAt: null as string | null,
        rejectionReason: null as string | null,
        updatedAt: null as string | null,
      };
    }
    const capacity =
      typeof doc.maxConcurrentOrders === 'number' &&
      doc.maxConcurrentOrders >= 1
        ? doc.maxConcurrentOrders
        : defaultDeliveryCapacity(doc.vehicle);
    return {
      status: doc.status,
      onboardingStep: doc.onboardingStep,
      vehicle: doc.vehicle ?? null,
      vehicleRegistration: doc.vehicleRegistration?.trim() || null,
      driverLicense: doc.driverLicense?.trim() || null,
      maxConcurrentOrders: capacity,
      serviceZone: doc.serviceZone ?? null,
      termsAccepted: Boolean(doc.termsAccepted),
      submittedAt: doc.submittedAt
        ? new Date(doc.submittedAt).toISOString()
        : null,
      rejectionReason: doc.rejectionReason ?? null,
      updatedAt: doc.updatedAt
        ? new Date(doc.updatedAt).toISOString()
        : null,
    };
  }

  async getOrCreateMine(user: UserModel) {
    this.assertEligible(user);
    const uid = user._id as Types.ObjectId;
    let doc = await this._applications
      .findOne({ user: uid })
      .select(APPLICATION_PUBLIC_SELECT)
      .lean<LeanApp>()
      .exec();
    if (!doc) {
      await this._applications.create({
        user: uid,
        status: DeliveryAgentApplicationStatus.DRAFT,
        onboardingStep: 0,
        termsAccepted: false,
      });
      doc = await this._applications
        .findOne({ user: uid })
        .select(APPLICATION_PUBLIC_SELECT)
        .lean<LeanApp>()
        .exec();
    }
    return this.toPublic(doc);
  }

  async patchMine(user: UserModel, dto: PatchDeliveryAgentApplicationDto) {
    this.assertEligible(user);
    const uid = user._id as Types.ObjectId;
    const existing = await this._applications.findOne({ user: uid }).exec();
    if (!existing) {
      await this.getOrCreateMine(user);
    }
    const cur = await this._applications.findOne({ user: uid }).exec();
    if (!cur) {
      throw new BadRequestException('delivery_agent_application_missing');
    }
    if (cur.status === DeliveryAgentApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('delivery_agent_application_locked');
    }
    if (cur.status === DeliveryAgentApplicationStatus.APPROVED) {
      throw new BadRequestException('delivery_agent_application_readonly');
    }
    if (cur.status === DeliveryAgentApplicationStatus.SUSPENDED) {
      throw new BadRequestException('delivery_agent_account_suspended');
    }

    if (cur.status === DeliveryAgentApplicationStatus.REJECTED) {
      cur.status = DeliveryAgentApplicationStatus.DRAFT;
      cur.rejectionReason = undefined;
    }

    if (dto.onboardingStep !== undefined) {
      cur.onboardingStep = dto.onboardingStep;
    }
    if (dto.vehicle !== undefined) {
      cur.vehicle = dto.vehicle;
      if (dto.maxConcurrentOrders === undefined) {
        cur.maxConcurrentOrders = defaultDeliveryCapacity(dto.vehicle);
      }
    }
    if (dto.vehicleRegistration !== undefined) {
      cur.vehicleRegistration =
        normalizeVehicleRegistration(
          cur.vehicle ?? dto.vehicle,
          dto.vehicleRegistration,
        ) ?? undefined;
    }
    if (dto.driverLicense !== undefined) {
      const lic = dto.driverLicense.trim();
      cur.driverLicense = lic.length > 0 ? lic : undefined;
    }
    if (dto.maxConcurrentOrders !== undefined) {
      cur.maxConcurrentOrders = dto.maxConcurrentOrders;
    }
    if (dto.serviceZone !== undefined) {
      cur.serviceZone = dto.serviceZone.trim();
    }
    if (dto.termsAccepted !== undefined) {
      cur.termsAccepted = dto.termsAccepted;
    }

    await cur.save();
    const lean = await this._applications
      .findOne({ user: uid })
      .select(APPLICATION_PUBLIC_SELECT)
      .lean<LeanApp>()
      .exec();
    return this.toPublic(lean);
  }

  async submitMine(user: UserModel) {
    this.assertEligible(user);
    const uid = user._id as Types.ObjectId;
    let cur = await this._applications.findOne({ user: uid }).exec();
    if (!cur) {
      await this.getOrCreateMine(user);
      cur = await this._applications.findOne({ user: uid }).exec();
    }
    if (!cur) {
      throw new BadRequestException('delivery_agent_application_missing');
    }
    if (cur.status === DeliveryAgentApplicationStatus.REJECTED) {
      throw new BadRequestException('delivery_agent_update_after_rejection');
    }
    if (cur.status === DeliveryAgentApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('delivery_agent_already_submitted');
    }
    if (cur.status === DeliveryAgentApplicationStatus.APPROVED) {
      throw new BadRequestException('delivery_agent_already_approved');
    }
    if (cur.status === DeliveryAgentApplicationStatus.SUSPENDED) {
      throw new BadRequestException('delivery_agent_account_suspended');
    }
    if (!cur.vehicle) {
      throw new BadRequestException('delivery_agent_vehicle_required');
    }
    if (vehicleRegistrationRequired(cur.vehicle)) {
      const immat = (cur.vehicleRegistration ?? '').trim();
      if (immat.length < 2) {
        throw new BadRequestException('delivery_agent_registration_required');
      }
    }
    if (driverLicenseRequired(cur.vehicle)) {
      const lic = (cur.driverLicense ?? '').trim();
      if (lic.length < 2) {
        throw new BadRequestException('delivery_agent_driver_license_required');
      }
    }
    if (
      typeof cur.maxConcurrentOrders !== 'number' ||
      cur.maxConcurrentOrders < 1
    ) {
      cur.maxConcurrentOrders = defaultDeliveryCapacity(cur.vehicle);
    }
    const zone = (cur.serviceZone ?? '').trim();
    if (zone.length < 5) {
      throw new BadRequestException('delivery_agent_zone_required');
    }
    if (!cur.termsAccepted) {
      throw new BadRequestException('delivery_agent_terms_required');
    }
    const phone = (user.phoneNumber ?? '').trim();
    if (phone.length < 8) {
      throw new BadRequestException('delivery_agent_phone_required');
    }
    const name = (user.fullName ?? '').trim();
    if (name.length < 2) {
      throw new BadRequestException('delivery_agent_name_required');
    }
    cur.serviceZone = zone;
    cur.status = DeliveryAgentApplicationStatus.AWAITING_REVIEW;
    cur.submittedAt = new Date();
    cur.onboardingStep = Math.max(cur.onboardingStep, 3);
    await cur.save();
    const lean = await this._applications
      .findOne({ user: uid })
      .select(APPLICATION_PUBLIC_SELECT)
      .lean<LeanApp>()
      .exec();
    return this.toPublic(lean);
  }

  private mapAdminRow(
    doc: LeanAppDoc,
    user?: {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      profileImage?: string;
      type?: string;
    },
  ) {
    const pub = this.toPublic(doc);
    const profile = (user?.profileImage ?? '').trim();
    return {
      ...pub,
      id: String(doc._id),
      userId: String(doc.user),
      userFullName: String(user?.fullName ?? '').trim(),
      userEmail: String(user?.email ?? '').trim(),
      userPhone: String(user?.phoneNumber ?? '').trim(),
      userProfileImageUrl: profile.length > 0 ? profile : null,
      userType: String(user?.type ?? ''),
      createdAt: doc.createdAt
        ? new Date(doc.createdAt).toISOString()
        : null,
    };
  }

  async listApplicationsAdmin(
    user: UserModel,
    statusFilter?: string,
  ) {
    this.assertAdmin(user);
    const filter: Record<string, unknown> = {};
    const status = (statusFilter ?? '').trim().toUpperCase();
    if (
      status &&
      Object.values(DeliveryAgentApplicationStatus).includes(
        status as DeliveryAgentApplicationStatus,
      )
    ) {
      filter.status = status;
    }
    const rows = await this._applications
      .find(filter)
      .sort({ submittedAt: -1, updatedAt: -1, createdAt: -1 })
      .lean<LeanAppDoc[]>()
      .exec();

    const userIds = [
      ...new Set(rows.map((r) => String(r.user)).filter((id) => Types.ObjectId.isValid(id))),
    ];
    const users = await this._users
      .find({ _id: { $in: userIds } })
      .select('fullName email phoneNumber profileImage type')
      .lean()
      .exec();
    const userById = new Map(
      users.map((u) => [String(u._id), u as Record<string, unknown>]),
    );

    return rows.map((r) =>
      this.mapAdminRow(
        r,
        userById.get(String(r.user)) as {
          fullName?: string;
          email?: string;
          phoneNumber?: string;
          type?: string;
        },
      ),
    );
  }

  async approveApplicationAdmin(user: UserModel, applicationId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    if (app.status !== DeliveryAgentApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('delivery_agent_application_not_pending');
    }
    app.status = DeliveryAgentApplicationStatus.APPROVED;
    app.rejectionReason = undefined;
    await app.save();

    await this._users
      .updateOne(
        { _id: app.user },
        { $set: { type: UserTypeEnum.DELIVERY } },
      )
      .exec();

    void this._notifyApplicationReview({
      userId: String(app.user),
      applicationId: String(app._id),
      status: 'APPROVED',
    });

    const lean = await this._applications
      .findById(app._id)
      .lean<LeanAppDoc>()
      .exec();
    const u = await this._users
      .findById(app.user)
      .select('fullName email phoneNumber profileImage type')
      .lean()
      .exec();
    return this.mapAdminRow(lean!, u as {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      type?: string;
    });
  }

  async rejectApplicationAdmin(
    user: UserModel,
    applicationId: string,
    rejectionReason: string,
  ) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    const reason = rejectionReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('delivery_agent_rejection_reason_required');
    }
    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    if (app.status !== DeliveryAgentApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('delivery_agent_application_not_pending');
    }
    app.status = DeliveryAgentApplicationStatus.REJECTED;
    app.rejectionReason = reason;
    await app.save();

    void this._notifyApplicationReview({
      userId: String(app.user),
      applicationId: String(app._id),
      status: 'REJECTED',
      rejectionReason: reason,
    });

    const lean = await this._applications
      .findById(app._id)
      .lean<LeanAppDoc>()
      .exec();
    const u = await this._users
      .findById(app.user)
      .select('fullName email phoneNumber profileImage type')
      .lean()
      .exec();
    return this.mapAdminRow(lean!, u as {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      type?: string;
    });
  }

  async suspendApplicationAdmin(
    user: UserModel,
    applicationId: string,
    suspensionReason?: string,
  ) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    if (app.status !== DeliveryAgentApplicationStatus.APPROVED) {
      throw new BadRequestException('delivery_agent_application_not_approved');
    }
    const reason = (suspensionReason ?? '').trim();
    app.status = DeliveryAgentApplicationStatus.SUSPENDED;
    app.rejectionReason =
      reason.length >= 3
        ? reason
        : 'Compte livreur suspendu par l’administrateur.';
    await app.save();

    await this._users
      .updateOne(
        { _id: app.user },
        { $set: { type: UserTypeEnum.USER } },
      )
      .exec();

    void this._notifyApplicationReview({
      userId: String(app.user),
      applicationId: String(app._id),
      status: 'SUSPENDED',
      rejectionReason: app.rejectionReason,
    });

    const lean = await this._applications
      .findById(app._id)
      .lean<LeanAppDoc>()
      .exec();
    const u = await this._users
      .findById(app.user)
      .select('fullName email phoneNumber profileImage type')
      .lean()
      .exec();
    return this.mapAdminRow(lean!, u as {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      type?: string;
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private async _notifyApplicationReview(args: {
    userId: string;
    applicationId: string;
    status: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
    rejectionReason?: string;
  }): Promise<void> {
    const approved = args.status === 'APPROVED';
    const suspended = args.status === 'SUSPENDED';
    const reason = (args.rejectionReason ?? '').trim();

    try {
      await this._notifications.notifyDeliveryAgentApplicationReview({
        recipientUserId: args.userId,
        applicationId: args.applicationId,
        status: args.status,
        rejectionReason: reason || undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._logger.warn(`notifyDeliveryAgentApplicationReview: ${msg}`);
    }

    const u = await this._users
      .findById(args.userId)
      .select('fullName email')
      .lean()
      .exec();
    const email = String(u?.email ?? '').trim();
    if (!email) return;

    const appName =
      this._config.get<string>('APP_NAME')?.trim() || 'Afrika Meals';
    const name = String(u?.fullName ?? '').trim() || 'Bonjour';
    const title = approved
      ? 'Candidature livreur acceptée'
      : suspended
        ? 'Compte livreur suspendu'
        : 'Candidature livreur refusée';
    const body = approved
      ? 'Félicitations ! Votre candidature livreur a été acceptée. Ouvrez l’application et passez en mode livreur pour commencer.'
      : suspended
        ? `Votre compte livreur a été suspendu. Vous ne pouvez plus prendre de courses.${reason ? ` Motif : ${reason}` : ''} Contactez le support pour plus d’informations.`
        : `Votre candidature livreur n’a pas été retenue.${reason ? ` Motif : ${reason}` : ''} Vous pouvez mettre à jour votre dossier et soumettre à nouveau.`;
    const safeName = this.escapeHtml(name);
    const safeBody = this.escapeHtml(body);
    const safeReason = reason ? this.escapeHtml(reason) : '';

    const html = approved
      ? `
<p>Bonjour ${safeName},</p>
<p>${safeBody}</p>
<p>— L’équipe ${this.escapeHtml(appName)}</p>`.trim()
      : suspended
        ? `
<p>Bonjour ${safeName},</p>
<p>${safeBody}</p>
${safeReason ? `<p><strong>Motif :</strong> ${safeReason}</p>` : ''}
<p>— L’équipe ${this.escapeHtml(appName)}</p>`.trim()
        : `
<p>Bonjour ${safeName},</p>
<p>${safeBody}</p>
${safeReason ? `<p><strong>Motif :</strong> ${safeReason}</p>` : ''}
<p>— L’équipe ${this.escapeHtml(appName)}</p>`.trim();

    try {
      await this._mailer.sendSimple({
        to: email,
        toName: name,
        subject: `${appName} — ${title}`,
        html,
        text: body,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._logger.warn(`delivery agent review email: ${msg}`);
    }
  }

  private assertDeliveryAgent(user: UserModel) {
    if (user.type !== UserTypeEnum.DELIVERY) {
      throw new ForbiddenException('delivery_agent_only');
    }
  }

  async listPendingOrders(user: UserModel) {
    this.assertDeliveryAgent(user);
    const { maxDeliveryRadiusKm } =
      await this._platformShipping.getPublicSettings();
    const rows = await this._orders
      .find({
        shouldShip: true,
        $or: [
          { assigned_delivery_user: { $exists: false } },
          { assigned_delivery_user: null },
        ],
        status: {
          $in: [
            OrderStatusEnum.CREATED,
            OrderStatusEnum.PAIED,
            OrderStatusEnum.APPROVED,
          ],
        },
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate({
        path: 'store',
        select: 'name address',
        populate: {
          path: 'address',
          select: 'address city zipCode location',
        },
      })
      .populate({
        path: 'user',
        select: 'fullName addresses',
        populate: {
          path: 'addresses',
          select: 'isDefault address city zipCode location label',
        },
      })
      .lean()
      .exec();

    const mapped = rows.map((row) =>
      this.mapOrderRowForAgent(row as Record<string, unknown>),
    );

    const items = mapped.filter((item) => {
      if (item.distanceKm == null) return false;
      return item.distanceKm <= maxDeliveryRadiusKm + 1e-9;
    });

    return { items, maxDeliveryRadiusKm };
  }

  /** Commande expédiée assignée au livreur connecté (carte + suivi). */
  async getActiveOrder(user: UserModel) {
    this.assertDeliveryAgent(user);
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const row = await this._orders
      .findOne({
        assigned_delivery_user: agentId,
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .populate({
        path: 'store',
        select: 'name address',
        populate: {
          path: 'address',
          select: 'address city zipCode location',
        },
      })
      .populate({
        path: 'user',
        select: 'fullName addresses',
        populate: {
          path: 'addresses',
          select: 'isDefault address city zipCode location label',
        },
      })
      .lean()
      .exec();
    if (!row) {
      return { item: null };
    }
    return {
      item: this.mapOrderRowForAgent(row as Record<string, unknown>),
    };
  }

  /** Met à jour la position GPS et notifie le suivi temps réel de la course active. */
  async reportLocation(user: UserModel, dto: DeliveryAgentLocationDto) {
    this.assertDeliveryAgent(user);
    const lat = Number(dto.latitude);
    const lng = Number(dto.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('invalid_coordinates');
    }
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    await this._applications
      .updateOne(
        { user: agentId },
        {
          $set: {
            lastLatitude: lat,
            lastLongitude: lng,
            locationUpdatedAt: new Date(),
          },
        },
      )
      .exec();

    const active = await this._orders
      .findOne({
        assigned_delivery_user: agentId,
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .select('_id')
      .lean()
      .exec();
    if (active?._id) {
      await this._ordersService.publishCourierPosition(
        String(active._id),
        lat,
        lng,
      );
    }
    return { ok: true };
  }

  async assignSelfToOrder(user: UserModel, orderId: string) {
    this.assertDeliveryAgent(user);
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('invalid_order_id');
    }
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const oid = new Types.ObjectId(orderId);

    const activeOrder = await this._orders
      .findOne({
        assigned_delivery_user: agentId,
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .select('_id')
      .lean()
      .exec();
    if (activeOrder && String(activeOrder._id) !== orderId) {
      throw new BadRequestException('delivery_agent_active_order');
    }

    const orderDoc = await this._orders
      .findById(oid)
      .populate('store', 'name owner address')
      .populate({
        path: 'user',
        select: 'fullName addresses',
        populate: { path: 'addresses' },
      })
      .exec();
    if (!orderDoc) {
      throw new NotFoundException('order_not_found');
    }
    if (!orderDoc.shouldShip) {
      throw new BadRequestException('order_not_shippable');
    }
    const existingAssignee = orderDoc.assignedDeliveryUser;
    if (
      existingAssignee &&
      String(existingAssignee) !== String(agentId)
    ) {
      throw new BadRequestException('order_assigned_to_other');
    }
    if (
      ![
        OrderStatusEnum.CREATED,
        OrderStatusEnum.PAIED,
        OrderStatusEnum.APPROVED,
      ].includes(orderDoc.status as OrderStatusEnum)
    ) {
      throw new BadRequestException('order_not_assignable');
    }

    const orderStoreId = this.storeIdFromPopulatedOrder(orderDoc);
    const prevOrderStatus = orderDoc.status as OrderStatusEnum;
    orderDoc.set('assigned_delivery_user', agentId);
    orderDoc.status = OrderStatusEnum.SHIPPED;
    await orderDoc.save();

    const customerId = this.customerUserIdFromOrder(orderDoc);
    const tail = String(orderDoc._id).slice(-6).toUpperCase();
    const orderRef = `#AE-${tail}`;

    if (prevOrderStatus !== OrderStatusEnum.SHIPPED) {
      await this._orderStatusEvents.record({
        orderId: orderDoc._id.toString(),
        storeId: orderStoreId ?? undefined,
        customerUserId: customerId ?? undefined,
        fromStatus: prevOrderStatus,
        toStatus: OrderStatusEnum.SHIPPED,
        source: OrderStatusChangeSourceEnum.DELIVERY_AGENT,
        actorUserId: String(agentId),
        note: 'Self-assign livreur',
      });
    }

    if (customerId && prevOrderStatus !== OrderStatusEnum.SHIPPED) {
      void this._notifications
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: orderDoc._id.toString(),
          storeName: this.storeNameFromPopulatedOrder(orderDoc),
          storeId: orderStoreId ?? undefined,
          previousStatus: prevOrderStatus,
          newStatus: OrderStatusEnum.SHIPPED,
          bodyOverride: 'En cours de livraison',
        })
        .catch((err) => {
          this._logger.warn(
            `FCM order shipped (delivery agent): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    this._ordersService.notifyPartiesOrderRealtimeFromDoc(
      orderDoc,
      OrderStatusEnum.SHIPPED,
    );

    const appLoc = await this._applications
      .findOne({ user: agentId })
      .select('lastLatitude lastLongitude')
      .lean()
      .exec();
    if (
      appLoc &&
      typeof appLoc.lastLatitude === 'number' &&
      typeof appLoc.lastLongitude === 'number'
    ) {
      await this._ordersService.publishCourierPosition(
        orderDoc._id.toString(),
        appLoc.lastLatitude,
        appLoc.lastLongitude,
      );
    }

    return { ok: true, orderId: orderDoc._id.toString(), orderRef };
  }

  private storeIdFromPopulatedOrder(orderDoc: OrderModel): string | null {
    const store = orderDoc.store;
    if (!store || typeof store !== 'object' || !('_id' in store)) {
      return null;
    }
    return String((store as { _id: unknown })._id);
  }

  private storeNameFromPopulatedOrder(orderDoc: OrderModel): string {
    const store = orderDoc.store;
    if (store && typeof store === 'object' && 'name' in store) {
      const name = String((store as { name?: string }).name ?? '').trim();
      if (name) return name;
    }
    return 'Boutique';
  }

  private customerUserIdFromOrder(orderDoc: OrderModel): string | null {
    const u = orderDoc.user;
    if (u == null) return null;
    if (typeof u === 'object') {
      const id = (u as { _id?: unknown })._id;
      if (id != null) return String(id);
    }
    return String(u);
  }

  getConnectStatus(user: UserModel) {
    this.assertDeliveryAgent(user);
    return this._stripeConnect.getConnectStatus(user);
  }

  createOnboardingLink(user: UserModel) {
    this.assertDeliveryAgent(user);
    return this._stripeConnect.createOnboardingLink(user);
  }

  listPayouts(user: UserModel, limit?: number, startingAfter?: string) {
    this.assertDeliveryAgent(user);
    return this._stripeConnect.listPayouts(user, limit, startingAfter);
  }

  getConnectBalance(user: UserModel) {
    this.assertDeliveryAgent(user);
    return this._stripeConnect.getConnectBalance(user);
  }

  getPayoutEstimate(user: UserModel) {
    this.assertDeliveryAgent(user);
    return this._stripeConnect.getPayoutEstimate(user);
  }

  requestPayout(user: UserModel) {
    this.assertDeliveryAgent(user);
    return this._stripeConnect.requestPayout(user);
  }

  async listShippingPaymentHistory(user: UserModel) {
    this.assertDeliveryAgent(user);
    const settings = await this._platformShipping.getPublicSettings();
    const rows = await this._orders
      .find({
        shouldShip: true,
        status: {
          $in: [OrderStatusEnum.SHIPPED, OrderStatusEnum.COMPLETED],
        },
      })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate({ path: 'store', select: 'name' })
      .lean()
      .exec();

    const items = rows.map((row) => {
      const id = String(row._id);
      const tail = id.slice(-6).toUpperCase();
      const shippingCad = Number(row.shippingPrice) || 0;
      const store =
        row.store && typeof row.store === 'object'
          ? (row.store as { name?: string })
          : null;
      return {
        id,
        orderRef: `#AE-${tail}`,
        storeName: store?.name?.trim() || null,
        shippingPriceCad: shippingCad,
        driverEarningCad: this.computeDriverEarningFromShipping(
          shippingCad,
          settings,
        ),
        status: String(row.status),
        completedAt:
          (row as { updatedAt?: Date }).updatedAt?.toISOString?.() ?? null,
      };
    });

    return { items };
  }

  private computeDriverEarningFromShipping(
    shippingPriceCad: number,
    settings: {
      deliveryWithheldFeeMode: string;
      deliveryWithheldFeeFixed: number;
      deliveryWithheldFeePercent: number;
    },
  ): number {
    const ship = Math.max(0, shippingPriceCad);
    const withheld =
      settings.deliveryWithheldFeeMode === 'percent'
        ? (ship * (Number(settings.deliveryWithheldFeePercent) || 0)) / 100
        : Number(settings.deliveryWithheldFeeFixed) || 0;
    return Math.max(0, Math.round((ship - withheld) * 100) / 100);
  }

  private mapOrderRowForAgent(row: Record<string, unknown>) {
    const id = String(row._id);
    const tail = id.slice(-6).toUpperCase();
    const shippingAddress = this.shippingLineFromOrder(row);
    const store =
      row.store && typeof row.store === 'object'
        ? (row.store as {
            name?: string;
            address?: unknown;
          })
        : null;
    const storeName = store?.name?.trim() || undefined;
    const storeAddr =
      store?.address && typeof store.address === 'object'
        ? (store.address as Record<string, unknown>)
        : undefined;
    const storeCoords = this.coordsFromAddressLike(storeAddr);
    const userAddr =
      this.deliveryAddressFromOrder(row) ??
      this.defaultUserAddressFromPopulated(row.user);
    let distanceKm: number | undefined;
    if (storeCoords && userAddr?.coords) {
      distanceKm = +haversineDistance(storeCoords, userAddr.coords).toFixed(2);
    }
    const destLng = userAddr?.coords?.[0];
    const destLat = userAddr?.coords?.[1];
    const storeLat = storeCoords?.[1];
    const storeLng = storeCoords?.[0];
    return {
      id,
      orderRef: `#AE-${tail}`,
      priceCad: Number(row.totalPrice) || 0,
      distanceKm: distanceKm ?? null,
      storeLat: storeLat != null && Number.isFinite(storeLat) ? storeLat : null,
      storeLng: storeLng != null && Number.isFinite(storeLng) ? storeLng : null,
      destinationLat:
        destLat != null && Number.isFinite(destLat) ? destLat : null,
      destinationLng:
        destLng != null && Number.isFinite(destLng) ? destLng : null,
      shippingAddress,
      storeName: storeName ?? null,
      customerName: (() => {
        const u = row.user;
        if (!u || typeof u !== 'object') return null;
        const name = String((u as { fullName?: string }).fullName ?? '').trim();
        return name || null;
      })(),
      eta: distanceKm != null ? this.etaLabelFromKm(distanceKm) : null,
    };
  }

  private deliveryAddressFromOrder(order: Record<string, unknown>): {
    line?: string;
    coords?: [number, number];
  } | null {
    const snap =
      order['deliveryAddressSnapshot'] ?? order['delivery_address_snapshot'];
    if (!snap || typeof snap !== 'object') return null;
    const doc = snap as Record<string, unknown>;
    const line = this.lineFromAddressDoc(doc);
    const coords = this.coordsFromAddressLike(doc);
    if (!line && !coords) return null;
    return { line: line || undefined, coords };
  }

  private shippingLineFromOrder(
    order: Record<string, unknown>,
  ): string {
    const fromOrder = this.deliveryAddressFromOrder(order);
    if (fromOrder?.line) return fromOrder.line;
    const userAddr = this.defaultUserAddressFromPopulated(order.user);
    if (userAddr?.line) return userAddr.line;
    return '—';
  }

  private lineFromAddressDoc(doc: Record<string, unknown>): string {
    const street = String(doc.address ?? '').trim();
    const city = String(doc.city ?? '').trim();
    const zip = String(doc.zipCode ?? doc.zip_code ?? '').trim();
    const parts = [
      street,
      [city, zip].filter((s) => s.length > 0).join(' '),
    ].filter((s) => s.length > 0);
    return parts.join(', ');
  }

  private etaLabelFromKm(km: number): string {
    const minutes = Math.max(15, Math.round(km * 4 + 10));
    return `${minutes} min`;
  }

  private isPopulatedAddressDoc(raw: unknown): raw is Record<string, unknown> {
    if (!raw || typeof raw !== 'object') return false;
    const m = raw as Record<string, unknown>;
    if (typeof m.address === 'string' && m.address.trim().length > 0) {
      return true;
    }
    if (typeof m.city === 'string' && m.city.trim().length > 0) {
      return true;
    }
    return false;
  }

  private defaultUserAddressFromPopulated(user: unknown): {
    line?: string;
    coords?: [number, number];
  } | null {
    if (!user || typeof user !== 'object') return null;
    const list = (user as { addresses?: unknown }).addresses;
    if (!Array.isArray(list) || list.length === 0) return null;
    const populated = list.filter((raw) => this.isPopulatedAddressDoc(raw));
    if (!populated.length) return null;

    let picked: Record<string, unknown> | null = null;
    for (const m of populated) {
      if (m.isDefault === true || m.is_default === true) {
        picked = m;
        break;
      }
    }
    picked ??= populated[0] ?? null;
    if (!picked) return null;
    const coords = this.coordsFromAddressLike(picked);
    const street = String(picked.address ?? '').trim();
    const city = String(picked.city ?? '').trim();
    const zip = String(picked.zipCode ?? picked.zip_code ?? '').trim();
    const parts = [
      street,
      [city, zip].filter((s) => s.length > 0).join(' '),
    ].filter((s) => s.length > 0);
    return {
      line: parts.join(', ') || undefined,
      coords: coords ?? undefined,
    };
  }

  private coordsFromAddressLike(
    addr: unknown,
  ): [number, number] | undefined {
    if (!addr || typeof addr !== 'object') return undefined;
    const loc = (addr as { location?: { coordinates?: unknown } }).location;
    const c = loc?.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return [lng, lat];
      }
    }
    const lat = Number((addr as { latitude?: unknown }).latitude);
    const lng = Number((addr as { longitude?: unknown }).longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [lng, lat];
    }
    return undefined;
  }
}
