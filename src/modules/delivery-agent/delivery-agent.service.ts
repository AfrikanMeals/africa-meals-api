import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
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
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { DeliveryAgentOrderRatingModel } from '@schemas/delivery-agent-order-rating.schema';
import { OrderStatusChangeSourceEnum } from '@schemas/order-status-event.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { StoreDeliveryDriversService } from '@modules/store-delivery-drivers/store-delivery-drivers.service';
import {
  StoreDeliveryAssignmentModeEnum,
  StoreModel,
} from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { haversineDistance } from 'src/utils/helpers';
import { StripeConnectService } from '@modules/billing/stripe/stripe-connect.service';
import { StripeConnectTransferService } from '@modules/billing/stripe/stripe-connect-transfer.service';
import { VendorStatusEmailService } from '@modules/vendor-emails/vendor-status-email.service';
import { PartnerOnboardingEmailService } from '@modules/vendor-emails/partner-onboarding-email.service';
import { resolveStripeOnboardingStatusLabel } from '@modules/billing/stripe/stripe-connect-visibility';
import {
  isPartnerBadgeCode,
  PartnerBadgeCode,
  resolveEffectivePartnerBadgeCode,
  serializePartnerBadge,
} from '@common/partner-badges/partner-badge.constants';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import { resolvePlatformShippingRegionCode } from '@modules/platform-shipping-settings/platform-shipping-region.util';
import {
  resolveOrderOperatingRegionCode,
} from '@modules/supported-countries/region-tax.util';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { PatchDeliveryAgentApplicationDto } from './dto/delivery-agent-application.dto';
import {
  parseDeliveryHistoryPage,
  parseDeliveryHistoryTake,
  resolveDeliveryHistoryStatusFilter,
} from './delivery-agent-history.util';
import { DeliveryAgentLocationDto } from './dto/delivery-agent-location.dto';
import {
  defaultDeliveryCapacity,
  driverLicenseRequired,
  normalizeVehicleRegistration,
  vehicleRegistrationRequired,
} from './delivery-agent-vehicle.util';
import {
  agentHasDeliveryCapacity,
  countActiveShippedOrdersForAgent,
  maxConcurrentOrdersFromApplication,
} from './delivery-agent-capacity.util';
import { courierTrackingExtraFromApplication } from '@modules/dashboard/dashboard-fleet-seed.util';
import { PatchDeliveryAgentPresenceDto } from './dto/patch-delivery-agent-presence.dto';
import {
  ConfirmDeliveryHandoffDto,
  PreviewDeliveryHandoffDto,
} from './dto/confirm-delivery-handoff.dto';
import { normalizePickupCodeInput } from 'src/utils/pickup-code';
import { mongoIdsEqual } from 'src/utils/mongoose-ref.util';
import { WsDeliveryAgentNotifyService } from '@modules/ws-notify/ws-delivery-agent-notify.service';
import { DomainEventPublisherService } from '../../common/domain-events/domain-event-publisher.service';
import { DomainEventDraft } from '../../common/domain-events/domain-event.types';
import { DomainEventType } from '../../common/domain-events/domain-event-types';
import { isDomainEventsEnabled } from '@modules/domain-event-handlers/domain-event-handlers.util';
import { FleetAudienceService } from '@modules/fleet/fleet-audience.service';
import { FleetSnapshotService } from '@modules/fleet/fleet-snapshot.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import {
  AGENT_LOCATION_EMIT_THROTTLE_MS,
  mapDeliveryPresenceToDomain,
  pendingOrderMatchesAgentOperatingRegion,
  pendingOrderWithinMaxDeliveryRadius,
  resolveDeliveryAgentPresence,
} from './delivery-agent-domain.util';

export type DeliveryAgentPresence =
  | 'disponible'
  | 'en_livraison'
  | 'hors_ligne';

type LeanApp = {
  status: DeliveryAgentApplicationStatus;
  onboardingStep: number;
  vehicle?: string;
  vehicleRegistration?: string;
  driverLicense?: string;
  maxConcurrentOrders?: number;
  region?: string;
  serviceZone?: string;
  termsAccepted: boolean;
  submittedAt?: Date;
  rejectionReason?: string;
  updatedAt?: Date;
};

const APPLICATION_PUBLIC_SELECT =
  'status onboardingStep vehicle vehicleRegistration driverLicense maxConcurrentOrders region serviceZone termsAccepted submittedAt rejectionReason updatedAt';

type LeanAppDoc = LeanApp & {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  createdAt?: Date;
};

@Injectable()
export class DeliveryAgentService {
  private readonly _logger = new Logger(DeliveryAgentService.name);
  private readonly locationEmitLastMs = new Map<string, number>();

  @InjectModel(DeliveryAgentApplicationModel.name)
  private readonly _applications: Model<DeliveryAgentApplicationModel>;

  @InjectModel(UserModel.name)
  private readonly _users: Model<UserModel>;

  @InjectModel(OrderModel.name)
  private readonly _orders: Model<OrderModel>;

  @InjectModel(StoreModel.name)
  private readonly _stores: Model<StoreModel>;

  @InjectModel(DeliveryAgentOrderRatingModel.name)
  private readonly _courierRatings: Model<DeliveryAgentOrderRatingModel>;

  constructor(
    @Inject(NotificationsService)
    private readonly _notifications: NotificationsService,
    @Inject(MailerService)
    private readonly _mailer: MailerService,
    private readonly _emailTpl: EmailTemplateService,
    private readonly _config: ConfigService,
    @Inject(PlatformShippingSettingsService)
    private readonly _platformShipping: PlatformShippingSettingsService,
    @Inject(SupportedCountriesService)
    private readonly _supportedCountries: SupportedCountriesService,
    @Inject(StripeConnectService)
    private readonly _stripeConnect: StripeConnectService,
    @Inject(StripeConnectTransferService)
    private readonly _stripeTransfers: StripeConnectTransferService,
    @Inject(VendorStatusEmailService)
    private readonly _vendorStatusEmail: VendorStatusEmailService,
    @Inject(PartnerOnboardingEmailService)
    private readonly _partnerOnboardingEmail: PartnerOnboardingEmailService,
    @Inject(OrderStatusEventsService)
    private readonly _orderStatusEvents: OrderStatusEventsService,
    @Inject(forwardRef(() => OrdersService))
    private readonly _ordersService: OrdersService,
    private readonly _storeDeliveryDrivers: StoreDeliveryDriversService,
    private readonly _wsDeliveryAgent: WsDeliveryAgentNotifyService,
    private readonly _fleet: FleetSnapshotService,
    private readonly _fleetAudience: FleetAudienceService,
    private readonly _subscriptions: SubscriptionsService,
    @Optional()
    private readonly _domainPublisher?: DomainEventPublisherService,
  ) {}

  private async publishAgentDomainEvent<T extends DomainEventType>(
    draft: DomainEventDraft<T>,
  ): Promise<void> {
    if (!isDomainEventsEnabled(this._config) || !this._domainPublisher) return;
    const result = await this._domainPublisher.publish(draft);
    if (!result.ok && result.mode !== 'duplicate') {
      this._logger.warn(
        `Agent domain event publish skipped type=${draft.type} reason=${result.reason ?? result.mode}`,
      );
    }
  }

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  assertEligible(user: UserModel) {
    if (user.type === UserTypeEnum.VENDOR || user.type === UserTypeEnum.ADMIN) {
      throw new ForbiddenException('delivery_agent_not_available_for_account');
    }
  }

  private defaultRegionForUser(user: UserModel): string {
    const raw = (
      (user as UserModel & { appCountryCode?: string }).appCountryCode ?? 'CA'
    )
      .trim()
      .toUpperCase();
    return raw.length === 2 ? raw : 'CA';
  }

  private async assertOperatingRegionSupported(region: string): Promise<void> {
    const code = region.trim().toUpperCase();
    if (code.length !== 2) {
      throw new BadRequestException('delivery_agent_region_required');
    }
    const activeCodes = new Set(
      (await this._supportedCountries.listActive()).map((x) =>
        x.code.toUpperCase(),
      ),
    );
    if (!activeCodes.has(code)) {
      throw new BadRequestException(
        'Ce pays n’est pas encore pris en charge pour les livreurs.',
      );
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
        region: null as string | null,
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
      region: doc.region?.trim().toUpperCase() || null,
      serviceZone: doc.serviceZone ?? null,
      termsAccepted: Boolean(doc.termsAccepted),
      submittedAt: doc.submittedAt
        ? new Date(doc.submittedAt).toISOString()
        : null,
      rejectionReason: doc.rejectionReason ?? null,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
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
      const defaultRegion = this.defaultRegionForUser(user);
      await this._applications.create({
        user: uid,
        status: DeliveryAgentApplicationStatus.DRAFT,
        onboardingStep: 0,
        termsAccepted: false,
        region: defaultRegion,
      });
      doc = await this._applications
        .findOne({ user: uid })
        .select(APPLICATION_PUBLIC_SELECT)
        .lean<LeanApp>()
        .exec();
    }
    const badgeUser = await this._users
      .findById(uid)
      .select('partnerBadgeCode')
      .lean<{ partnerBadgeCode?: string }>()
      .exec();
    return {
      ...this.toPublic(doc),
      partnerBadge: serializePartnerBadge(badgeUser?.partnerBadgeCode),
    };
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
    if (dto.region !== undefined) {
      const next = dto.region.trim().toUpperCase();
      await this.assertOperatingRegionSupported(next);
      cur.region = next;
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
    const region = (cur.region ?? '').trim().toUpperCase();
    if (region.length !== 2) {
      throw new BadRequestException('delivery_agent_region_required');
    }
    await this.assertOperatingRegionSupported(region);
    cur.region = region;
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
    void this._partnerOnboardingEmail
      .notifyDeliveryAgentOnboardingWelcome({
        email: String(user.email ?? '').trim(),
        name: String(user.fullName ?? '').trim(),
      })
      .catch((e) =>
        this._logger.warn(
          `delivery onboarding welcome email: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
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
      partnerBadgeCode?: string;
      stripeConnectAccountId?: string;
      stripeConnectChargesEnabled?: boolean;
      stripeConnectPayoutsEnabled?: boolean;
      stripeConnectDetailsSubmitted?: boolean;
      stripeConnectDisabledReason?: string;
      stripeConnectRequirementsDue?: string[];
      stripeConnectRequirementsPastDue?: string[];
    },
  ) {
    const pub = this.toPublic(doc);
    const profile = (user?.profileImage ?? '').trim();
    const stripeOnboardingStatus = resolveStripeOnboardingStatusLabel(user);
    const accountId = String(user?.stripeConnectAccountId ?? '').trim();
    return {
      ...pub,
      id: String(doc._id),
      userId: String(doc.user),
      userFullName: String(user?.fullName ?? '').trim(),
      userEmail: String(user?.email ?? '').trim(),
      userPhone: String(user?.phoneNumber ?? '').trim(),
      userProfileImageUrl: profile.length > 0 ? profile : null,
      userType: String(user?.type ?? ''),
      partnerBadge: serializePartnerBadge(user?.partnerBadgeCode),
      stripeOnboardingStatus,
      stripeConnectLinked: accountId.length > 0,
      stripeConnectActive: stripeOnboardingStatus === 'COMPLETE',
      stripeConnectAccountId: accountId.length > 0 ? accountId : null,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    };
  }

  async listApplicationsAdmin(user: UserModel, statusFilter?: string) {
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
      ...new Set(
        rows
          .map((r) => String(r.user))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const users = await this._users
      .find({ _id: { $in: userIds } })
      .select(
        'fullName email phoneNumber profileImage type partnerBadgeCode stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
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
    if (app.status === DeliveryAgentApplicationStatus.SUSPENDED) {
      return this.reactivateApplicationAdmin(user, applicationId);
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
        {
          $set: {
            type: UserTypeEnum.DELIVERY,
            partnerBadgeCode: PartnerBadgeCode.SILVER,
          },
        },
      )
      .exec();

    const approvedUser = await this._users.findById(app.user).exec();
    if (approvedUser?.stripeConnectAccountId?.trim()) {
      await this._stripeConnect.ensurePartnerBadgePayoutScheduleForUser(
        approvedUser,
      );
    }

    void this._notifyApplicationReview({
      userId: String(app.user),
      applicationId: String(app._id),
      status: 'APPROVED',
    });

    void this.emitAgentCapacityChanged(
      String(app.user),
      maxConcurrentOrdersFromApplication(app),
    );

    const lean = await this._applications
      .findById(app._id)
      .lean<LeanAppDoc>()
      .exec();
    const u = await this._users
      .findById(app.user)
      .select('fullName email phoneNumber profileImage type')
      .lean()
      .exec();
    return this.mapAdminRow(
      lean!,
      u as {
        fullName?: string;
        email?: string;
        phoneNumber?: string;
        type?: string;
      },
    );
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
    return this.mapAdminRow(
      lean!,
      u as {
        fullName?: string;
        email?: string;
        phoneNumber?: string;
        type?: string;
      },
    );
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
      .updateOne({ _id: app.user }, { $set: { type: UserTypeEnum.USER } })
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
    return this.mapAdminRow(
      lean!,
      u as {
        fullName?: string;
        email?: string;
        phoneNumber?: string;
        type?: string;
      },
    );
  }

  async reactivateApplicationAdmin(user: UserModel, applicationId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    if (app.status !== DeliveryAgentApplicationStatus.SUSPENDED) {
      throw new BadRequestException('delivery_agent_application_not_suspended');
    }

    app.status = DeliveryAgentApplicationStatus.APPROVED;
    app.rejectionReason = undefined;
    await app.save();

    await this._users
      .updateOne({ _id: app.user }, { $set: { type: UserTypeEnum.DELIVERY } })
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
    return this.mapAdminRow(
      lean!,
      u as {
        fullName?: string;
        email?: string;
        phoneNumber?: string;
        type?: string;
      },
    );
  }

  private adminUserSelect =
    'fullName email phoneNumber profileImage type partnerBadgeCode stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue';

  async setApplicationPartnerBadgeForAdmin(
    user: UserModel,
    applicationId: string,
    badgeCode: string | null | undefined,
  ) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }

    if (badgeCode != null && badgeCode !== '') {
      const raw = String(badgeCode).trim().toUpperCase();
      if (!isPartnerBadgeCode(raw)) {
        throw new BadRequestException('invalid_partner_badge');
      }
    }
    const normalizedBadge = resolveEffectivePartnerBadgeCode(
      badgeCode == null || badgeCode === '' ? null : badgeCode,
    );

    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    if (app.status !== DeliveryAgentApplicationStatus.APPROVED) {
      throw new BadRequestException('delivery_agent_application_not_approved');
    }

    const agentUser = await this._users.findById(app.user).exec();
    if (!agentUser) {
      throw new NotFoundException('user_not_found');
    }

    const previousBadge = resolveEffectivePartnerBadgeCode(
      agentUser.partnerBadgeCode,
    );
    const userId = String(agentUser._id);

    agentUser.partnerBadgeCode = normalizedBadge;
    await agentUser.save();

    const connectAccountId = String(agentUser.stripeConnectAccountId ?? '').trim();
    if (connectAccountId) {
      await this._stripeConnect.applyPartnerBadgePayoutSchedule(
        connectAccountId,
        normalizedBadge,
      );
    }

    void this._vendorStatusEmail
      .notifyPartnerBadgeChanged({
        recipientRole: 'delivery',
        userId,
        previousBadgeCode: previousBadge,
        newBadgeCode: normalizedBadge,
      })
      .catch((e) =>
        this._logger.warn(
          `partner_badge_email_failed user=${userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

    const lean = await this._applications
      .findById(app._id)
      .lean<LeanAppDoc>()
      .exec();
    const u = await this._users
      .findById(app.user)
      .select(this.adminUserSelect)
      .lean()
      .exec();
    return this.mapAdminRow(lean!, u as Record<string, unknown>);
  }

  private async _requireApprovedApplication(applicationId: string) {
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
    return app;
  }

  private async _reloadAdminApplicationRow(applicationId: string) {
    const lean = await this._applications
      .findById(applicationId)
      .lean<LeanAppDoc>()
      .exec();
    if (!lean) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    const u = await this._users
      .findById(lean.user)
      .select(this.adminUserSelect)
      .lean()
      .exec();
    return this.mapAdminRow(lean, u as Record<string, unknown>);
  }

  /** Admin : lie un compte Stripe Connect existant au livreur approuvé. */
  async assignDeliveryAgentStripeConnectForAdmin(
    admin: UserModel,
    applicationId: string,
    stripeAccountId: string,
  ) {
    this.assertAdmin(admin);
    const app = await this._requireApprovedApplication(applicationId);
    await this._stripeConnect.assignConnectAccountForUserAdmin({
      userId: new Types.ObjectId(String(app.user)),
      stripeAccountId,
    });
    return this._reloadAdminApplicationRow(applicationId);
  }

  /** Admin : resynchronise le statut Stripe Connect depuis Stripe. */
  async syncDeliveryAgentStripeConnectForAdmin(
    admin: UserModel,
    applicationId: string,
  ) {
    this.assertAdmin(admin);
    const app = await this._requireApprovedApplication(applicationId);
    await this._stripeConnect.syncConnectAccountForUserAdmin({
      userId: new Types.ObjectId(String(app.user)),
    });
    return this._reloadAdminApplicationRow(applicationId);
  }

  /** Admin : déconnecte Stripe Connect pour permettre un nouvel onboarding. */
  async resetDeliveryAgentStripeConnectForAdmin(
    admin: UserModel,
    applicationId: string,
  ) {
    this.assertAdmin(admin);
    const app = await this._requireApprovedApplication(applicationId);
    await this._stripeConnect.resetConnectForReonboarding({
      userId: new Types.ObjectId(String(app.user)),
    });
    return this._reloadAdminApplicationRow(applicationId);
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
      this._config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const name = String(u?.fullName ?? '').trim() || 'Bonjour';
    const title = approved
      ? 'Candidature livreur acceptée'
      : suspended
      ? 'Compte livreur suspendu'
      : 'Candidature livreur refusée';
    const body = approved
      ? 'Félicitations ! Votre candidature livreur a été acceptée. Ouvrez l’application et passez en mode livreur pour commencer.'
      : suspended
      ? `Votre compte livreur a été suspendu. Vous ne pouvez plus prendre de courses.${
          reason ? ` Motif : ${reason}` : ''
        } Contactez le support pour plus d’informations.`
      : `Votre candidature livreur n’a pas été retenue.${
          reason ? ` Motif : ${reason}` : ''
        } Vous pouvez mettre à jour votre dossier et soumettre à nouveau.`;
    const safeName = this.escapeHtml(name);
    const safeBody = this.escapeHtml(body);
    const safeReason = reason ? this.escapeHtml(reason) : '';

    const html = [
      this._emailTpl.heading(title),
      this._emailTpl.paragraph(`Bonjour <strong>${safeName}</strong>,`),
      this._emailTpl.paragraph(safeBody),
      safeReason
        ? this._emailTpl.infoPanel(
            this._emailTpl.paragraph(`<strong>Motif :</strong> ${safeReason}`),
          )
        : '',
    ]
      .filter(Boolean)
      .join('\n');

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

  async listPendingInvites(user: UserModel) {
    return this._storeDeliveryDrivers.listPendingInvitesForUser(user);
  }

  async listStorePartners(user: UserModel) {
    this.assertDeliveryAgent(user);
    const userId = String(user._id ?? user.id);
    return this._storeDeliveryDrivers.listActivePartnersForDriver(userId);
  }

  async acceptStoreDriverInvite(user: UserModel, token: string) {
    return this._storeDeliveryDrivers.acceptInvite(user, token);
  }

  async declineStoreDriverInvite(user: UserModel, token: string) {
    return this._storeDeliveryDrivers.declineInvite(user, token);
  }

  async leaveStorePartner(user: UserModel, membershipId: string) {
    this.assertDeliveryAgent(user);
    return this._storeDeliveryDrivers.leaveActivePartner(user, membershipId);
  }

  /** Expéditions du jour + note moyenne livreur (carte performance mobile). */
  async getDailyPerformanceStats(user: UserModel) {
    this.assertDeliveryAgent(user);
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [ordersShippedToday, ratingAgg] = await Promise.all([
      this._orders
        .countDocuments({
          assignedDeliveryUser: agentId,
          shouldShip: true,
          status: {
            $in: [OrderStatusEnum.SHIPPED, OrderStatusEnum.COMPLETED],
          },
          updatedAt: { $gte: startOfDay },
        })
        .exec(),
      this._courierRatings
        .aggregate<{ avg?: number; count?: number }>([
          { $match: { deliveryAgent: agentId } },
          {
            $group: {
              _id: null,
              avg: { $avg: '$rate' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
    ]);

    const ratingRow = ratingAgg[0];
    const ratingCount = Math.max(0, Math.round(Number(ratingRow?.count ?? 0)));
    const avgRaw = Number(ratingRow?.avg ?? NaN);
    const averageRating =
      ratingCount > 0 && Number.isFinite(avgRaw)
        ? Math.round(avgRaw * 10) / 10
        : null;

    return {
      ordersShippedToday,
      averageRating,
      ratingCount,
    };
  }

  async listPendingOrders(user: UserModel) {
    this.assertDeliveryAgent(user);
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const app = await this._applications
      .findOne({
        user: agentId,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .select('region')
      .lean()
      .exec();
    const agentRegionCode = resolvePlatformShippingRegionCode([
      typeof app?.region === 'string' ? app.region : null,
      user.appCountryCode,
    ]);
    const agentSettings = await this._platformShipping.getPublicSettings(
      agentRegionCode,
    );
    const rows = await this._orders
      .find({
        shouldShip: true,
        $or: [
          { assignedDeliveryUser: { $exists: false } },
          { assignedDeliveryUser: null },
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
        select:
          'name currency phoneNumber address region vendorManagesDeliveryDrivers deliveryAssignmentMode',
        populate: {
          path: 'address',
          select: 'address city zipCode location countryCode',
        },
      })
      .populate({
        path: 'user',
        select: 'fullName addresses appCountryCode',
        populate: {
          path: 'addresses',
          select: 'isDefault address city zipCode location label countryCode',
        },
      })
      .lean()
      .exec();

    const mapped = rows.map((row) =>
      this.mapOrderRowForAgent(row as Record<string, unknown>),
    );

    const userStoreIds = new Set(
      await this._storeDeliveryDrivers.listStoreIdsForActiveDriver(
        String(agentId),
      ),
    );

    const managedStoreRows = await this._stores
      .find({ vendorManagesDeliveryDrivers: true })
      .select('_id deliveryAssignmentMode')
      .lean()
      .exec();
    const managedStoreMap = new Map(
      managedStoreRows.map((s) => [String(s._id), s]),
    );
    const managedStoreIds = [...managedStoreMap.keys()];
    const selfDeliveryByStore =
      await this._subscriptions.resolveSelfDeliveryRequiredByStoreIds(
        managedStoreIds,
      );

    const settingsCache = new Map<
      string,
      Awaited<ReturnType<PlatformShippingSettingsService['getPublicSettings']>>
    >();
    const resolveSettings = async (regionCode?: string) => {
      const key = regionCode?.trim().toUpperCase() || '__global__';
      let cached = settingsCache.get(key);
      if (!cached) {
        cached = await this._platformShipping.getPublicSettings(
          key === '__global__' ? undefined : key,
        );
        settingsCache.set(key, cached);
      }
      return cached;
    };

    const items: typeof mapped = [];
    for (let i = 0; i < mapped.length; i++) {
      const item = mapped[i];
      const row = rows[i] as Record<string, unknown>;
      if (
        !this.isPendingOrderEligibleForAgent(item, {
          managedStoreMap,
          userStoreIds,
          selfDeliveryByStore,
        })
      ) {
        continue;
      }
      const storeRegionCode = this.resolveStoreRegionCodeFromOrderRow(row);
      if (
        !pendingOrderMatchesAgentOperatingRegion(
          storeRegionCode,
          agentRegionCode,
        )
      ) {
        continue;
      }
      const maxDeliveryRadiusKm = await this.resolveMaxDeliveryRadiusKmForOrderRow(
        row,
        user,
        resolveSettings,
      );
      if (
        !pendingOrderWithinMaxDeliveryRadius(
          item.distanceKm,
          maxDeliveryRadiusKm,
        )
      ) {
        continue;
      }
      items.push(item);
    }

    this._logger.debug(
      `[DeliveryTrace] listPendingOrders agent=${String(agentId)} ` +
        `unassignedFetched=${mapped.length} afterFilter=${items.length} ` +
        `agentRegion=${agentRegionCode ?? 'global'} ` +
        `agentRadiusKm=${agentSettings.maxDeliveryRadiusKm}`,
    );

    return {
      items,
      maxDeliveryRadiusKm: agentSettings.maxDeliveryRadiusKm,
    };
  }

  /** Commandes expédiées assignées au livreur connecté (carte + suivi). */
  async getActiveOrder(user: UserModel) {
    this.assertDeliveryAgent(user);
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const app = await this._applications
      .findOne({
        user: agentId,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .select('vehicle maxConcurrentOrders')
      .lean()
      .exec();
    const capacity = maxConcurrentOrdersFromApplication(app);
    const rows = await this._orders
      .find({
        assignedDeliveryUser: agentId,
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .sort({ updatedAt: -1 })
      .limit(Math.max(capacity, 1))
      .populate({
        path: 'store',
        select: 'name currency address',
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
    const items = rows.map((row) =>
      this.mapOrderRowForAgent(row as Record<string, unknown>),
    );
    this._logger.debug(
      `[DeliveryTrace] getActiveOrder agent=${agentId.toString()} ` +
        `count=${items.length} capacity=${capacity} ` +
        `ids=[${items.map((i) => i.id).join(',')}]`,
    );
    for (const it of items) {
      if (it.destinationLat == null || it.destinationLng == null) {
        this._logger.warn(
          `[DeliveryTrace] getActiveOrder order=${it.id} ` +
            `agent=${agentId.toString()} SANS coords destination ` +
            `(route non traçable) storeCoords=${it.storeLat != null}`,
        );
      }
    }
    if (items.length === 0) {
      const shippedAny = await this._orders.countDocuments({
        assignedDeliveryUser: agentId,
        status: OrderStatusEnum.SHIPPED,
      });
      const assignedNotShipped = await this._orders
        .find({
          assignedDeliveryUser: agentId,
          status: { $ne: OrderStatusEnum.SHIPPED },
        })
        .select('_id status')
        .lean()
        .exec();
      const orphanShipped = await this._orders.countDocuments({
        status: OrderStatusEnum.SHIPPED,
        shouldShip: true,
        $or: [
          { assignedDeliveryUser: { $exists: false } },
          { assignedDeliveryUser: null },
        ],
      });
      this._logger.debug(
        `[DeliveryTrace] getActiveOrder agent=${agentId.toString()} ` +
          `AUCUNE course active. shippedAssigned(anyShouldShip)=${shippedAny} ` +
          `assignedNotShipped=${assignedNotShipped.length} ` +
          `orphanShippedSansLivreur=${orphanShipped}`,
      );
      for (const o of assignedNotShipped) {
        this._logger.warn(
          `[DeliveryTrace] ALERTE order=${String(o._id)} assigné à ` +
            `agent=${agentId.toString()} mais status=${o.status} (≠ shipped) — ` +
            `incohérent : livreur assigné sans expédition`,
        );
      }
      if (orphanShipped > 0) {
        this._logger.warn(
          `[DeliveryTrace] ALERTE ${orphanShipped} commande(s) SHIPPED ` +
            `sans livreur assigné (orphelines) — nettoyage requis`,
        );
      }
    }
    return {
      items,
      count: items.length,
      maxConcurrentOrders: capacity,
      item: items[0] ?? null,
    };
  }

  async getPresence(user: UserModel) {
    this.assertDeliveryAgent(user);
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const [app, activeCount] = await Promise.all([
      this._applications
        .findOne({
          user: agentId,
          status: DeliveryAgentApplicationStatus.APPROVED,
        })
        .select('dashboardAvailability vehicle maxConcurrentOrders')
        .lean()
        .exec(),
      countActiveShippedOrdersForAgent(this._orders, agentId),
    ]);
    if (!app) {
      throw new NotFoundException('delivery_agent_application_not_found');
    }
    const availability =
      app.dashboardAvailability === 'hors_ligne' ? 'hors_ligne' : 'disponible';
    const presence = resolveDeliveryAgentPresence(availability, activeCount);
    this._logger.debug(
      `[DeliveryTrace] getPresence agent=${agentId.toString()} ` +
        `availability=${availability} presence=${presence} ` +
        `activeCount=${activeCount}`,
    );
    return {
      availability,
      presence,
      activeOrderCount: activeCount,
      maxConcurrentOrders: maxConcurrentOrdersFromApplication(app),
    };
  }

  async setPresence(user: UserModel, dto: PatchDeliveryAgentPresenceDto) {
    this.assertDeliveryAgent(user);
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const [app, activeCount] = await Promise.all([
      this.assertAgentApprovedApplication(agentId),
      countActiveShippedOrdersForAgent(this._orders, agentId),
    ]);

    if (dto.availability === 'hors_ligne' && activeCount > 0) {
      throw new BadRequestException('delivery_agent_has_active_orders');
    }

    const availability: 'disponible' | 'hors_ligne' =
      dto.availability === 'hors_ligne' ? 'hors_ligne' : 'disponible';

    if (availability === 'disponible') {
      await this.assertAgentStripeOnboardingComplete(user);
    }

    await this._applications
      .updateOne(
        {
          user: agentId,
          status: DeliveryAgentApplicationStatus.APPROVED,
        },
        { $set: { dashboardAvailability: availability } },
      )
      .exec();

    const presence = resolveDeliveryAgentPresence(availability, activeCount);
    const maxConcurrentOrders = maxConcurrentOrdersFromApplication(app);
    const result = {
      availability,
      presence,
      activeOrderCount: activeCount,
      maxConcurrentOrders,
    };

    await this.emitAgentPresenceChanged({
      agentUserId: String(agentId),
      ...result,
      reason: 'manual_toggle',
    });

    return result;
  }

  /** Diffuse la présence livreur (bus domaine ou WS legacy). */
  async publishPresenceWs(
    agentUserId: string,
    reason:
      | 'manual_toggle'
      | 'order_assigned'
      | 'order_completed'
      | 'order_unassigned'
      | 'admin_toggle' = 'manual_toggle',
  ): Promise<void> {
    const uid = agentUserId?.trim();
    if (!uid || !Types.ObjectId.isValid(uid)) return;
    const agentId = new Types.ObjectId(uid);
    const app = await this._applications
      .findOne({
        user: agentId,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .select('dashboardAvailability vehicle maxConcurrentOrders')
      .lean()
      .exec();
    if (!app) return;
    const activeCount = await countActiveShippedOrdersForAgent(
      this._orders,
      agentId,
    );
    const availability =
      app.dashboardAvailability === 'hors_ligne' ? 'hors_ligne' : 'disponible';
    await this.emitAgentPresenceChanged({
      agentUserId: uid,
      availability,
      presence: resolveDeliveryAgentPresence(availability, activeCount),
      activeOrderCount: activeCount,
      maxConcurrentOrders: maxConcurrentOrdersFromApplication(app),
      reason,
    });
  }

  private async emitAgentPresenceChanged(params: {
    agentUserId: string;
    availability: 'disponible' | 'hors_ligne';
    presence: DeliveryAgentPresence;
    activeOrderCount: number;
    maxConcurrentOrders: number;
    reason:
      | 'manual_toggle'
      | 'order_assigned'
      | 'order_completed'
      | 'order_unassigned'
      | 'admin_toggle';
  }): Promise<void> {
    const storeIds = await this._fleetAudience.resolveNotifyStoreIds(
      params.agentUserId,
    );

    this._fleet.pushAgentUpdate({
      agentUserId: params.agentUserId,
      presence: params.presence,
      availability: params.availability,
      activeOrderCount: params.activeOrderCount,
      maxConcurrentOrders: params.maxConcurrentOrders,
      notifyStoreIds: storeIds,
    });
    this._wsDeliveryAgent.notifyPresence({
      agentUserId: params.agentUserId,
      availability: params.availability,
      presence: params.presence,
      activeOrderCount: params.activeOrderCount,
      maxConcurrentOrders: params.maxConcurrentOrders,
      reason: params.reason,
      storeIds,
    });

    if (!isDomainEventsEnabled(this._config)) {
      return;
    }

    await this.publishAgentDomainEvent({
      type: 'agent.presence.changed',
      payload: {
        agentUserId: params.agentUserId,
        presence: mapDeliveryPresenceToDomain(params.presence),
        activeOrderCount: params.activeOrderCount,
      },
      metadata: {
        source: 'delivery-agent',
        orderContext: {
          maxConcurrentOrders: params.maxConcurrentOrders,
          reason: params.reason,
          availability: params.availability,
          storeIds,
        },
      },
    });
  }

  private async emitAgentLocationUpdated(params: {
    agentUserId: string;
    latitude: number;
    longitude: number;
    orderId?: string;
  }): Promise<void> {
    const agentUserId = params.agentUserId.trim();
    if (!agentUserId) return;
    const now = Date.now();
    const last = this.locationEmitLastMs.get(agentUserId) ?? 0;
    if (now - last < AGENT_LOCATION_EMIT_THROTTLE_MS) return;
    this.locationEmitLastMs.set(agentUserId, now);

    this._fleet.pushAgentUpdate({
      agentUserId,
      latitude: params.latitude,
      longitude: params.longitude,
      orderId: params.orderId,
      notifyStoreIds: await this._fleetAudience.resolveNotifyStoreIds(agentUserId),
    });

    if (!isDomainEventsEnabled(this._config)) {
      return;
    }

    await this.publishAgentDomainEvent({
      type: 'agent.location.updated',
      payload: {
        agentUserId,
        latitude: params.latitude,
        longitude: params.longitude,
        orderId: params.orderId,
      },
      metadata: { source: 'delivery-agent' },
    });
  }

  async emitAgentCapacityChanged(
    agentUserId: string,
    maxConcurrentOrders: number,
  ): Promise<void> {
    const uid = agentUserId.trim();
    if (!uid || maxConcurrentOrders < 1) return;

    if (!isDomainEventsEnabled(this._config)) {
      this._fleet.pushAgentUpdate({
        agentUserId: uid,
        maxConcurrentOrders,
      });
      return;
    }

    await this.publishAgentDomainEvent({
      type: 'agent.capacity.changed',
      payload: { agentUserId: uid, maxConcurrentOrders },
      metadata: { source: 'delivery-agent' },
    });
  }

  private async assertAgentApprovedApplication(agentId: Types.ObjectId) {
    const app = await this._applications
      .findOne({
        user: agentId,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      // `region` obligatoire pour assign-self : sans elle, le filtre tombe sur
      // user.appCountryCode et peut rejeter une course CM alors que le dossier
      // livreur est bien en CM (régression : commande visible en pending, 400 au claim).
      .select('dashboardAvailability vehicle maxConcurrentOrders region')
      .lean()
      .exec();
    if (!app) {
      throw new BadRequestException('delivery_agent_not_approved');
    }
    return app;
  }

  /** Stripe Connect requis pour passer disponible / prendre une course. */
  private async assertAgentStripeOnboardingComplete(user: UserModel) {
    const status = await this._stripeConnect.getConnectStatus(user);
    if (!status?.onboardingComplete) {
      throw new BadRequestException(
        'delivery_agent_stripe_onboarding_incomplete',
      );
    }
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

    const activeOrderIds = await this._ordersService.publishCourierPositionsForAgent(
      String(agentId),
          lat,
          lng,
        );
    const primaryOrderId = activeOrderIds[0];
    await this.emitAgentLocationUpdated({
      agentUserId: String(agentId),
      latitude: lat,
      longitude: lng,
      orderId: primaryOrderId,
    });
    return { ok: true };
  }

  async previewHandoffByCode(
    user: UserModel,
    rawCode: string,
    orderId?: string,
  ) {
    this.assertDeliveryAgent(user);
    const order = await this.findAssignedOrderByHandoffCode(
      user,
      rawCode,
      orderId,
    );
    if (!order) {
      throw new NotFoundException('handoff_code_not_found');
    }
    const mapped = this.mapOrderRowForAgent(
      order as unknown as Record<string, unknown>,
    );
    const isDelivery = order.shouldShip === true;
    return {
      ...mapped,
      pickupCode: String(order.pickupCode ?? '').trim().toUpperCase() || null,
      shouldShip: isDelivery,
      handoffType: isDelivery ? 'delivery' : 'pickup',
    };
  }

  async confirmHandoffByCode(
    user: UserModel,
    orderId: string,
    rawCode: string,
  ) {
    this.assertDeliveryAgent(user);
    return this._ordersService.confirmHandoffByDeliveryAgent(orderId, user, {
      code: rawCode,
    });
  }

  private async findAssignedOrderByHandoffCode(
    user: UserModel,
    rawCode: string,
    orderId?: string,
  ): Promise<OrderModel | null> {
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const provided = normalizePickupCodeInput(rawCode);
    if (!provided) return null;

    const oid = orderId?.trim();
    if (oid && Types.ObjectId.isValid(oid)) {
      const row = await this._orders
        .findById(new Types.ObjectId(oid))
        .populate('store', 'name address')
        .populate({
          path: 'user',
          select: 'fullName addresses',
          populate: {
            path: 'addresses',
            select: 'isDefault address city zipCode location label',
          },
        })
        .exec();
      if (!row) return null;

      const assignee =
        row.assignedDeliveryUser ??
        (row as unknown as Record<string, unknown>).assignedDeliveryUser;
      if (!mongoIdsEqual(assignee, agentId)) {
        throw new ForbiddenException('order_not_assigned_to_agent');
      }

      const st = row.status as OrderStatusEnum;
      if (
        st !== OrderStatusEnum.SHIPPED &&
        st !== OrderStatusEnum.APPROVED
      ) {
        return null;
      }

      const expected = normalizePickupCodeInput(String(row.pickupCode ?? ''));
      return expected && expected === provided ? row : null;
    }

    const rows = await this._orders
      .find({
        assignedDeliveryUser: agentId,
        status: {
          $in: [OrderStatusEnum.SHIPPED, OrderStatusEnum.APPROVED],
        },
      })
      .populate('store', 'name address')
      .populate({
        path: 'user',
        select: 'fullName addresses',
        populate: {
          path: 'addresses',
          select: 'isDefault address city zipCode location label',
        },
      })
      .limit(20)
      .exec();

    for (const row of rows) {
      const expected = normalizePickupCodeInput(String(row.pickupCode ?? ''));
      if (expected && expected === provided) {
        return row;
      }
    }
    return null;
  }

  async assignSelfToOrder(user: UserModel, orderId: string) {
    this.assertDeliveryAgent(user);
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('invalid_order_id');
    }
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const oid = new Types.ObjectId(orderId);

    const app = await this.assertAgentApprovedApplication(agentId);
    await this.assertAgentStripeOnboardingComplete(user);
    if (app.dashboardAvailability === 'hors_ligne') {
      throw new BadRequestException('delivery_agent_offline');
    }

    const capacityCheck = await agentHasDeliveryCapacity(
      this._orders,
      app,
      agentId,
    );
    if (!capacityCheck.allowed) {
      throw new BadRequestException('delivery_agent_capacity_full');
    }

    let orderDoc = await this._orders
      .findById(oid)
      .populate({
        path: 'store',
        select:
          'name owner phoneNumber currency address region vendorManagesDeliveryDrivers deliveryAssignmentMode',
        populate: {
          path: 'address',
          // Même projection que listPendingOrders — sans `location`, distanceKm
          // est null et pendingOrderWithinMaxDeliveryRadius refuse l’assignation.
          select: 'address city zipCode location countryCode',
        },
      })
      .populate({
        path: 'user',
        select: 'fullName addresses appCountryCode',
        populate: {
          path: 'addresses',
          select: 'isDefault address city zipCode location label countryCode',
        },
      })
      .exec();
    if (!orderDoc) {
      throw new NotFoundException('order_not_found');
    }
    if (!orderDoc.shouldShip) {
      throw new BadRequestException('order_not_shippable');
    }
    const existingAssignee = orderDoc.assignedDeliveryUser;
    if (existingAssignee && String(existingAssignee) !== String(agentId)) {
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
    const storePop =
      orderDoc.store && typeof orderDoc.store === 'object'
        ? (orderDoc.store as StoreModel)
        : null;
    if (storePop?.vendorManagesDeliveryDrivers) {
      const policy = await this._subscriptions.resolveStoreDeliveryPolicy(
        orderStoreId,
      );
      if (policy.selfDeliveryRequired) {
        const mode = String(
          storePop.deliveryAssignmentMode ?? StoreDeliveryAssignmentModeEnum.AUTO,
        ).toUpperCase();
        if (mode === StoreDeliveryAssignmentModeEnum.MANUAL) {
          throw new BadRequestException('order_manual_assignment_only');
        }
        if (!orderStoreId) {
          throw new BadRequestException('order_store_missing');
        }
        const isMember = await this._storeDeliveryDrivers.isActiveStoreDriver(
          orderStoreId,
          String(agentId),
        );
        if (!isMember) {
          throw new ForbiddenException('store_driver_membership_required');
        }
      }
    }

    const mappedForRadius = this.mapOrderRowForAgent(
      orderDoc.toObject() as Record<string, unknown>,
    );
    const storeRegionCode = this.resolveStoreRegionCodeFromOrderRow(
      orderDoc.toObject() as Record<string, unknown>,
    );
    const agentRegionCode = resolvePlatformShippingRegionCode([
      typeof app.region === 'string' ? app.region : null,
      user.appCountryCode,
    ]);
    if (
      !pendingOrderMatchesAgentOperatingRegion(
        storeRegionCode,
        agentRegionCode,
      )
    ) {
      throw new BadRequestException('order_outside_agent_region');
    }
    const radiusSettings = await this._platformShipping.getPublicSettings(
      storeRegionCode ??
        resolvePlatformShippingRegionCode([user.appCountryCode]),
    );
    if (
      !pendingOrderWithinMaxDeliveryRadius(
        mappedForRadius.distanceKm,
        radiusSettings.maxDeliveryRadiusKm,
      )
    ) {
      this._logger.warn(
        `[DeliveryTrace] assignSelfToOrder radius reject order=${oid.toString()} ` +
          `distanceKm=${mappedForRadius.distanceKm} ` +
          `maxKm=${radiusSettings.maxDeliveryRadiusKm} ` +
          `storeLat=${mappedForRadius.storeLat} storeLng=${mappedForRadius.storeLng}`,
      );
      throw new BadRequestException('order_outside_delivery_radius');
    }

    const prevOrderStatus = orderDoc.status as OrderStatusEnum;

    const claimFilter = {
      _id: oid,
      shouldShip: true,
      $or: [
        { assignedDeliveryUser: { $exists: false } },
        { assignedDeliveryUser: null },
      ],
      status: {
        $in: [
          OrderStatusEnum.CREATED,
          OrderStatusEnum.PAIED,
          OrderStatusEnum.APPROVED,
        ],
      },
    } as Record<string, unknown>;

    const claimUpdate = {
      $set: {
        assignedDeliveryUser: agentId,
        status: OrderStatusEnum.SHIPPED,
      },
    };

    const claimResult = await this._orders.updateOne(claimFilter, claimUpdate).exec();

    if (claimResult.matchedCount === 0) {
      const fresh = await this._orders
        .findById(oid)
        .select('assignedDeliveryUser status shouldShip')
        .lean()
        .exec();
      if (!fresh) {
        throw new NotFoundException('order_not_found');
      }
      const persistedAgent = fresh.assignedDeliveryUser
        ? String(fresh.assignedDeliveryUser)
        : '';
      if (
        persistedAgent === String(agentId) &&
        fresh.status === OrderStatusEnum.SHIPPED
      ) {
        // Idempotent : déjà assignée à ce livreur.
      } else if (persistedAgent) {
        throw new BadRequestException('order_assigned_to_other');
      } else {
        throw new BadRequestException('order_not_assignable');
      }
    }

    const reloaded = await this._orders
      .findById(oid)
      .populate(
        'store',
        'name owner address region vendorManagesDeliveryDrivers deliveryAssignmentMode',
      )
      .populate({
        path: 'user',
        select: 'fullName addresses',
        populate: { path: 'addresses' },
      })
      .exec();
    if (!reloaded) {
      throw new NotFoundException('order_not_found');
    }
    orderDoc = reloaded;

    const persisted = await this._orders
      .findById(oid)
      .select('assignedDeliveryUser status')
      .lean()
      .exec();
    const persistedAgent = persisted?.assignedDeliveryUser
      ? String(persisted.assignedDeliveryUser)
      : null;
    this._logger.debug(
      `[DeliveryTrace] assignSelfToOrder order=${oid.toString()} ` +
        `agent=${agentId.toString()} prevStatus=${prevOrderStatus} ` +
        `persistedAgent=${persistedAgent} persistedStatus=${persisted?.status}`,
    );
    if (persistedAgent !== String(agentId)) {
      this._logger.error(
        `[DeliveryTrace] ALERTE assignSelfToOrder order=${oid.toString()} ` +
          `assignation NON persistée (attendu=${agentId.toString()} ` +
          `obtenu=${persistedAgent})`,
      );
    }

    const customerId = this.customerUserIdFromOrder(orderDoc);
    const tail = String(orderDoc._id).slice(-6).toUpperCase();
    const orderRef = `#AE-${tail}`;

    if (prevOrderStatus !== OrderStatusEnum.SHIPPED) {
      await this._ordersService.recordOrderStatusChangeIfLegacy({
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
      this._ordersService.sendShippedInvoiceEmail(orderDoc._id.toString());
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

    const appLoc = await this._applications
      .findOne({ user: agentId })
      .select('lastLatitude lastLongitude')
      .lean()
      .exec();

    const courierTrackingExtra = courierTrackingExtraFromApplication(appLoc);
    this._ordersService.emitOrderShippedFromDoc(orderDoc, {
      prevStatus: prevOrderStatus,
      assignedDeliveryUserId: String(agentId),
      actorUserId: String(agentId),
      source: OrderStatusChangeSourceEnum.DELIVERY_AGENT,
      courierTrackingExtra,
    });

    if (orderStoreId && prevOrderStatus !== OrderStatusEnum.SHIPPED) {
      const sname = this.storeNameFromPopulatedOrder(orderDoc);
      const agentName = user.fullName?.trim() || 'Livreur';
      this._ordersService.notifyStoreVendorsForOrderStatusChange(orderDoc, {
        reason: 'order_shipped',
        status: OrderStatusEnum.SHIPPED,
        note: `Prise en charge par ${agentName}`,
        pushBodyOverride: `${
          sname ?? 'Boutique'
        } : commande prise en charge par ${agentName}.`,
      });
    }

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

    await this.publishPresenceWs(String(agentId), 'order_assigned');

    return { ok: true, orderId: orderDoc._id.toString(), orderRef };
  }

  /**
   * Le livreur abandonne une course en cours : retrait assignation, repasse en
   * `approved`, notification vendeur uniquement (pas de push client), pas de gain.
   */
  async abandonOrderDelivery(user: UserModel, orderId: string) {
    this.assertDeliveryAgent(user);
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('invalid_order_id');
    }
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const oid = new Types.ObjectId(orderId);

    await this.assertAgentApprovedApplication(agentId);

    const orderDoc = await this._orders
      .findById(oid)
      .populate('store', 'name owner')
      .populate({ path: 'user', select: 'fullName' })
      .exec();
    if (!orderDoc) {
      throw new NotFoundException('order_not_found');
    }
    if (!orderDoc.shouldShip) {
      throw new BadRequestException('order_not_shippable');
    }
    if ((orderDoc.status as OrderStatusEnum) !== OrderStatusEnum.SHIPPED) {
      throw new BadRequestException('order_not_abandonable');
    }
    const assignee = orderDoc.assignedDeliveryUser
      ? String(orderDoc.assignedDeliveryUser)
      : '';
    if (!assignee || assignee !== String(agentId)) {
      throw new ForbiddenException('order_not_assigned_to_agent');
    }

    const orderStoreId = this.storeIdFromPopulatedOrder(orderDoc);
    const prevAssignee = assignee;

    orderDoc.set('assignedDeliveryUser', undefined);
    orderDoc.status = OrderStatusEnum.APPROVED;
    orderDoc.deliveryUnassignReason = 'courier_abandon';
    orderDoc.deliveryUnassignedAt = new Date();
    orderDoc.set('deliveryUnassignedFromUser', agentId);
    orderDoc.set('deliveryUnassignedByUser', agentId);
    orderDoc.courierAbandonNoPayout = true;
    await orderDoc.save();

    const customerId = this.customerUserIdFromOrder(orderDoc);
    await this._ordersService.recordOrderStatusChangeIfLegacy({
      orderId: orderDoc._id.toString(),
      storeId: orderStoreId ?? undefined,
      customerUserId: customerId ?? undefined,
      fromStatus: OrderStatusEnum.SHIPPED,
      toStatus: OrderStatusEnum.APPROVED,
      source: OrderStatusChangeSourceEnum.DELIVERY_AGENT,
      actorUserId: String(agentId),
      note: 'Course abandonnée par le livreur',
    });

    this._ordersService.notifyOrderPartiesRealtime(
      orderDoc,
      OrderStatusEnum.APPROVED,
      { assignedDeliveryUserId: null },
      { additionalPartyUserIds: [prevAssignee] },
    );

    if (orderStoreId) {
      const sname = this.storeNameFromPopulatedOrder(orderDoc);
      const agentName = user.fullName?.trim() || 'Livreur';
      this._ordersService.notifyStoreVendorsForOrderStatusChange(orderDoc, {
        reason: 'courier_abandoned',
        status: OrderStatusEnum.APPROVED,
        note: `Course abandonnée par ${agentName}`,
        pushBodyOverride: `${
          sname ?? 'Boutique'
        } : ${agentName} a abandonné la course — à réassigner.`,
      });
    }

    await this.publishPresenceWs(prevAssignee, 'order_unassigned');

    return {
      ok: true,
      orderId: orderDoc._id.toString(),
      status: OrderStatusEnum.APPROVED,
      abandoned: true,
      noPayout: true,
    };
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

  /**
   * Après le transfer Connect livraison (commande complétée), aligne le
   * versement bancaire du livreur sur son badge partenaire (SILVER/GOLD =
   * calendrier automatique ; DIAMOND = versement instantané). Best-effort.
   */
  async settleDeliveryBadgePayoutAfterTransfer(
    agentUserId: string,
  ): Promise<void> {
    if (!agentUserId || !Types.ObjectId.isValid(agentUserId)) return;
    const agent = await this._users.findById(agentUserId).exec();
    if (!agent || agent.type !== UserTypeEnum.DELIVERY) return;
    await this._stripeConnect.settlePartnerBadgePayoutAfterTransfer(agent);
  }

  async listShippingPaymentHistory(user: UserModel) {
    this.assertDeliveryAgent(user);
    const { items, totals } = await this.loadAgentDeliveryHistory(user, {
      limit: 50,
    });
    const earningsItems = items.map(
      ({
        customerName: _c,
        shippingAddress: _a,
        distanceKm: _d,
        ...earning
      }) => earning,
    );
    return { items: earningsItems, totals };
  }

  /** Historique livraisons (mobile onglet Historique). */
  async listDeliveryHistory(
    user: UserModel,
    query?: { status?: string; page?: string; take?: string },
  ) {
    this.assertDeliveryAgent(user);
    const page = parseDeliveryHistoryPage(query?.page);
    const take = parseDeliveryHistoryTake(query?.take, 20);
    const statuses = resolveDeliveryHistoryStatusFilter(query?.status);
    const { items, hasMore } = await this.loadAgentDeliveryHistory(user, {
      limit: take,
      skip: (page - 1) * take,
      statuses,
    });
    return { items, page, take, hasMore };
  }

  /** Admin — synthèse performance + gains + Stripe pour un livreur approuvé. */
  async getApplicationFinanceOverviewForAdmin(
    admin: UserModel,
    applicationId: string,
  ) {
    this.assertAdmin(admin);
    const app = await this._requireApprovedApplication(applicationId);
    const agentUser = await this._users.findById(app.user).exec();
    if (!agentUser) {
      throw new NotFoundException('user_not_found');
    }

    const agentId = new Types.ObjectId(String(agentUser._id));
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const deliveredStatuses = [
      OrderStatusEnum.SHIPPED,
      OrderStatusEnum.COMPLETED,
    ];
    const earningsWindow = 50;

    const [
      deliveredAgg,
      abandonAgg,
      ratingAgg,
      earnings,
      connectStatus,
      connectBalance,
      recentPayouts,
    ] = await Promise.all([
      this._orders
        .aggregate<{
          total?: number;
          today?: number;
          revenueTotal?: number;
          revenueToday?: number;
        }>([
          {
            $match: {
              shouldShip: true,
              assignedDeliveryUser: agentId,
              status: { $in: deliveredStatuses },
              courierAbandonNoPayout: { $ne: true },
            },
          },
          {
            $group: {
              _id: null,
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
                    { $ifNull: ['$shippingPrice', 0] },
                    0,
                  ],
                },
              },
            },
          },
        ])
        .exec(),
      this._orders
        .aggregate<{ abandonsTotal?: number; abandonsToday?: number }>([
          {
            $match: {
              shouldShip: true,
              deliveryUnassignedFromUser: agentId,
              deliveryUnassignReason: 'courier_abandon',
            },
          },
          {
            $group: {
              _id: null,
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
      this._courierRatings
        .aggregate<{ avg?: number; count?: number }>([
          { $match: { deliveryAgent: agentId } },
          {
            $group: {
              _id: null,
              avg: { $avg: '$rate' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
      this.loadAgentDeliveryHistory(agentUser, { limit: earningsWindow }),
      this._stripeConnect
        .getConnectStatus(agentUser)
        .catch(() => null),
      agentUser.stripeConnectAccountId?.trim()
        ? this._stripeConnect.getConnectBalance(agentUser).catch(() => null)
        : Promise.resolve(null),
      agentUser.stripeConnectAccountId?.trim()
        ? this._stripeConnect
            .listPayouts(agentUser, 20)
            .catch(() => ({ payouts: [], hasMore: false }))
        : Promise.resolve({ payouts: [], hasMore: false }),
    ]);

    const deliveredRow = deliveredAgg[0];
    const abandonRow = abandonAgg[0];
    const ratingRow = ratingAgg[0];
    const ratingCount = Math.max(0, Math.round(Number(ratingRow?.count ?? 0)));
    const avgRaw = Number(ratingRow?.avg ?? NaN);
    const averageRating =
      ratingCount > 0 && Number.isFinite(avgRaw)
        ? Math.round(avgRaw * 10) / 10
        : null;

    const earningsItems = earnings.items.map(
      ({
        customerName: _c,
        shippingAddress: _a,
        distanceKm: _d,
        ...earning
      }) => earning,
    );

    return {
      applicationId: String(app._id),
      userId: String(agentUser._id),
      stats: {
        ordersDeliveredTotal: Number(deliveredRow?.total ?? 0),
        ordersDeliveredToday: Number(deliveredRow?.today ?? 0),
        shippingRevenueTotal:
          Math.round(Number(deliveredRow?.revenueTotal ?? 0) * 100) / 100,
        shippingRevenueToday:
          Math.round(Number(deliveredRow?.revenueToday ?? 0) * 100) / 100,
        courierAbandonsTotal: Number(abandonRow?.abandonsTotal ?? 0),
        courierAbandonsToday: Number(abandonRow?.abandonsToday ?? 0),
        averageRating,
        ratingCount,
      },
      earnings: {
        windowLimit: earningsWindow,
        items: earningsItems,
        totals: earnings.totals,
      },
      stripe: {
        connectStatus,
        balance: connectBalance,
        recentPayouts: recentPayouts.payouts ?? [],
        hasMorePayouts: recentPayouts.hasMore === true,
      },
    };
  }

  /**
   * Admin — (re)transfer des commandes sélectionnées et/ou payout forcé
   * du solde Connect, indépendamment du badge partenaire.
   */
  async processPaymentsForAdmin(
    admin: UserModel,
    applicationId: string,
    dto: {
      orderIds?: string[];
      forceInstantPayout?: boolean;
      payoutOnly?: boolean;
    },
  ) {
    this.assertAdmin(admin);
    const app = await this._requireApprovedApplication(applicationId);
    const agentUser = await this._users.findById(app.user).exec();
    if (!agentUser) {
      throw new NotFoundException('user_not_found');
    }
    const agentId = String(agentUser._id);

    const payoutOnly = dto.payoutOnly === true;
    const forceInstantPayout = dto.forceInstantPayout !== false;
    const orderIds = [
      ...new Set(
        (dto.orderIds ?? [])
          .map((id) => String(id ?? '').trim())
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ].slice(0, 50);

    const transfers: Array<{
      orderId: string;
      transferred: boolean;
      transferId?: string;
      transferCents?: number;
      tipTransferred?: boolean;
      tipTransferId?: string;
      skippedReason?: string;
    }> = [];

    if (!payoutOnly && orderIds.length > 0) {
      for (const orderId of orderIds) {
        const order = await this._orders
          .findById(orderId)
          .select('assignedDeliveryUser shouldShip status')
          .lean()
          .exec();
        if (!order) {
          transfers.push({
            orderId,
            transferred: false,
            skippedReason: 'order_not_found',
          });
          continue;
        }
        const assigned = order.assignedDeliveryUser
          ? String(order.assignedDeliveryUser)
          : '';
        if (assigned !== agentId) {
          transfers.push({
            orderId,
            transferred: false,
            skippedReason: 'order_not_assigned_to_agent',
          });
          continue;
        }
        if (!order.shouldShip) {
          transfers.push({
            orderId,
            transferred: false,
            skippedReason: 'not_delivery_order',
          });
          continue;
        }

        const shipTr =
          await this._stripeTransfers.transferDeliveryShareForCompletedOrder({
            orderId,
          });
        const tipTr =
          await this._stripeTransfers.transferDeliveryTipForCompletedOrder({
            orderId,
          });
        transfers.push({
          orderId,
          transferred: shipTr.transferred,
          transferId: shipTr.transferId,
          transferCents: shipTr.transferCents,
          tipTransferred: tipTr.transferred,
          tipTransferId: tipTr.transferId,
          skippedReason: shipTr.transferred
            ? undefined
            : shipTr.skippedReason,
        });
      }
    }

    let payout: Awaited<
      ReturnType<StripeConnectService['requestPayout']>
    > | null = null;
    let payoutError: string | null = null;
    if (forceInstantPayout) {
      try {
        payout = await this._stripeConnect.requestPayout(agentUser, {
          forceInstant: true,
        });
      } catch (e) {
        const msg =
          e && typeof e === 'object' && 'getResponse' in e
            ? (() => {
                try {
                  const r = (
                    e as { getResponse: () => unknown }
                  ).getResponse();
                  if (typeof r === 'string') return r;
                  if (
                    r &&
                    typeof r === 'object' &&
                    'message' in r
                  ) {
                    const m = (r as { message?: unknown }).message;
                    return Array.isArray(m)
                      ? m.join(', ')
                      : String(m ?? '');
                  }
                  return JSON.stringify(r);
                } catch {
                  return e instanceof Error ? e.message : String(e);
                }
              })()
            : e instanceof Error
              ? e.message
              : String(e);
        payoutError = msg || 'stripe_payout_request_failed';
        this._logger.warn(
          `Admin force payout failed application=${applicationId}: ${payoutError}`,
        );
      }
    }

    return {
      applicationId: String(app._id),
      userId: agentId,
      transfers,
      payout,
      payoutError,
      forceInstantPayout,
    };
  }

  /** Admin — détail Stripe d’un transfer Connect lié au livreur. */
  async getStripeTransferDetailsForAdmin(
    admin: UserModel,
    applicationId: string,
    transferId: string,
  ) {
    this.assertAdmin(admin);
    const app = await this._requireApprovedApplication(applicationId);
    const agentUser = await this._users.findById(app.user).exec();
    if (!agentUser) {
      throw new NotFoundException('user_not_found');
    }
    const accountId = String(agentUser.stripeConnectAccountId ?? '').trim();
    const details =
      await this._stripeConnect.retrievePlatformTransfer(transferId);
    if (
      accountId &&
      details.destination &&
      details.destination !== accountId
    ) {
      throw new BadRequestException('stripe_transfer_not_for_agent');
    }
    // Vérifie aussi qu’une commande de ce livreur référence ce transfer.
    const linkedOrder = await this._orders
      .findOne({
        assignedDeliveryUser: agentUser._id,
        $or: [
          { stripeDeliveryTransferId: transferId },
          { stripeDeliveryTipTransferId: transferId },
        ],
      })
      .select('_id')
      .lean()
      .exec();
    return {
      ...details,
      linkedOrderId: linkedOrder?._id ? String(linkedOrder._id) : null,
      agentAccountId: accountId || null,
    };
  }

  private async loadAgentDeliveryHistory(
    user: UserModel,
    opts: {
      limit: number;
      skip?: number;
      statuses?: OrderStatusEnum[];
    },
  ) {
    const agentId = new Types.ObjectId(String(user.id));
    const limit = Math.max(1, Math.min(opts.limit, 100));
    const skip = Math.max(0, Math.floor(opts.skip ?? 0));
    const statuses =
      opts.statuses && opts.statuses.length > 0
        ? opts.statuses
        : [OrderStatusEnum.SHIPPED, OrderStatusEnum.COMPLETED];
    const rows = await this._orders
      .find({
        shouldShip: true,
        assignedDeliveryUser: agentId,
        status: { $in: statuses },
        courierAbandonNoPayout: { $ne: true },
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit + 1)
      .populate({
        path: 'store',
        select: 'name currency address region',
        populate: {
          path: 'address',
          select: 'address city zipCode location countryCode',
        },
      })
      .populate({
        path: 'user',
        select: 'fullName addresses appCountryCode',
        populate: {
          path: 'addresses',
          select: 'isDefault address city zipCode location label countryCode',
        },
      })
      .lean()
      .exec();

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const settingsCache = new Map<
      string,
      Awaited<ReturnType<PlatformShippingSettingsService['getPublicSettings']>>
    >();
    const resolveSettings = async (regionCode?: string) => {
      const key = regionCode?.trim().toUpperCase() || '__global__';
      let cached = settingsCache.get(key);
      if (!cached) {
        cached = await this._platformShipping.getPublicSettings(
          key === '__global__' ? undefined : key,
        );
        settingsCache.set(key, cached);
      }
      return cached;
    };

    let totalDriverEarningCad = 0;
    let totalDriverTipEarningCad = 0;
    let totalPlatformWithheldCad = 0;

    const items = await Promise.all(
      pageRows.map(async (row) => {
        const mapped = this.mapOrderRowForAgent(
          row as unknown as Record<string, unknown>,
        );
        const id = mapped.id;
        const shippingCad = Number(row.shippingPrice) || 0;
        const currency = mapped.currency;
        const regionCode = resolvePlatformShippingRegionCode([
          resolveOrderOperatingRegionCode(row as Record<string, unknown>),
          user.appCountryCode,
        ]);
        const settings = await resolveSettings(regionCode);
        const { driverEarning: driverEarningCad, platformWithheld: platformWithheldCad } =
          this.computeDriverEarningBreakdown(shippingCad, settings);
        const tipCents = Math.max(
          0,
          Math.round(Number(row.deliveryTipCents) || 0),
        );
        const tipStatus = String(row.deliveryTipStatus ?? 'none');
        let driverTipEarningCad = 0;
        if (tipStatus === 'transferred') {
          driverTipEarningCad =
            Math.round(Number(row.stripeDeliveryTipTransferAmountCents) || 0) /
            100;
        }
        const driverTotalEarningCad =
          Math.round((driverEarningCad + driverTipEarningCad) * 100) / 100;
        totalDriverEarningCad += driverEarningCad;
        totalDriverTipEarningCad += driverTipEarningCad;
        totalPlatformWithheldCad += platformWithheldCad;

        const status = String(row.status);
        const stripeTransferId =
          typeof row.stripeDeliveryTransferId === 'string'
            ? row.stripeDeliveryTransferId.trim()
            : '';
        const stripeTransferAmountCad =
          Math.round(Number(row.stripeDeliveryTransferAmountCents) || 0) / 100;
        const stripeProcessingFeeCad =
          Math.round(Number(row.stripeDeliveryProcessingFeeCents) || 0) / 100;
        const payoutStatus = this.resolveCourierPayoutStatus({
          orderStatus: status,
          stripeTransferId,
          stripeTransferAmountCad,
          driverEarningCad,
          stripeProcessingFeeCad,
        });

        const pickedUpAt = (row as { pickedUpAt?: Date }).pickedUpAt;
        const updatedAt = (row as { updatedAt?: Date }).updatedAt;
        const completedAt =
          status === OrderStatusEnum.COMPLETED
            ? pickedUpAt ?? updatedAt
            : updatedAt;

        return {
          id,
          orderRef: mapped.orderRef,
          storeName: mapped.storeName ?? null,
          customerName: mapped.customerName ?? null,
          shippingAddress: mapped.shippingAddress ?? null,
          distanceKm: mapped.distanceKm ?? null,
          currency,
          shippingPriceCad: shippingCad,
          platformWithheldCad,
          driverEarningCad,
          stripeProcessingFeeCad,
          stripeTransferAmountCad,
          stripeTransferId: stripeTransferId || null,
          payoutStatus,
          deliveryTipCents: tipCents,
          deliveryTipStatus: tipStatus,
          driverTipEarningCad,
          driverTotalEarningCad,
          status,
          completedAt: completedAt?.toISOString?.() ?? null,
        };
      }),
    );

    return {
      items,
      hasMore,
      totals: {
        driverEarningCad: Math.round(totalDriverEarningCad * 100) / 100,
        driverTipEarningCad: Math.round(totalDriverTipEarningCad * 100) / 100,
        driverTotalEarningCad:
          Math.round((totalDriverEarningCad + totalDriverTipEarningCad) * 100) /
          100,
        platformWithheldCad: Math.round(totalPlatformWithheldCad * 100) / 100,
      },
    };
  }

  private resolveCourierPayoutStatus(args: {
    orderStatus: string;
    stripeTransferId: string;
    stripeTransferAmountCad: number;
    driverEarningCad: number;
    stripeProcessingFeeCad: number;
  }): string {
    if (args.orderStatus !== OrderStatusEnum.COMPLETED) {
      return 'estimated';
    }
    if (args.stripeTransferId) {
      return 'transferred';
    }
    const expectedNet = Math.max(
      0,
      args.driverEarningCad - args.stripeProcessingFeeCad,
    );
    if (expectedNet <= 0) {
      return 'no_payout';
    }
    return 'pending';
  }

  private computeDriverEarningBreakdown(
    shippingPriceCad: number,
    settings: {
      deliveryWithheldFeeMode: string;
      deliveryWithheldFeeFixed: number;
      deliveryWithheldFeePercent: number;
    },
  ): { driverEarning: number; platformWithheld: number } {
    const ship = Math.max(0, shippingPriceCad);
    const withheldRaw =
      settings.deliveryWithheldFeeMode === 'percent'
        ? (ship * (Number(settings.deliveryWithheldFeePercent) || 0)) / 100
        : Number(settings.deliveryWithheldFeeFixed) || 0;
    const platformWithheld = Math.min(ship, Math.max(0, withheldRaw));
    const driverEarning = Math.max(
      0,
      Math.round((ship - platformWithheld) * 100) / 100,
    );
    return {
      driverEarning,
      platformWithheld: Math.round(platformWithheld * 100) / 100,
    };
  }

  private orderCurrencyFromRow(
    row: Record<string, unknown>,
    store?: { currency?: string } | null,
  ): string {
    if (typeof row.currency === 'string' && row.currency.trim()) {
      return row.currency.trim().toUpperCase();
    }
    if (typeof store?.currency === 'string' && store.currency.trim()) {
      return store.currency.trim().toUpperCase();
    }
    return 'CAD';
  }

  private isPendingOrderEligibleForAgent(
    item: { storeId?: string | null },
    ctx: {
      managedStoreMap: Map<string, { deliveryAssignmentMode?: string }>;
      userStoreIds: Set<string>;
      selfDeliveryByStore: Map<string, boolean>;
    },
  ): boolean {
    const sid = item.storeId ?? '';
    const managed = sid ? ctx.managedStoreMap.get(sid) : undefined;
    if (managed) {
      const selfDeliveryRequired = ctx.selfDeliveryByStore.get(sid) === true;
      if (selfDeliveryRequired) {
        if (!ctx.userStoreIds.has(sid)) return false;
        const mode = String(
          managed.deliveryAssignmentMode ??
            StoreDeliveryAssignmentModeEnum.AUTO,
        ).toUpperCase();
        if (mode === StoreDeliveryAssignmentModeEnum.MANUAL) return false;
        return true;
      }
      if (ctx.userStoreIds.has(sid)) {
        const mode = String(
          managed.deliveryAssignmentMode ??
            StoreDeliveryAssignmentModeEnum.AUTO,
        ).toUpperCase();
        if (mode === StoreDeliveryAssignmentModeEnum.MANUAL) return false;
        return true;
      }
    }
    return true;
  }

  private resolveStoreRegionCodeFromOrderRow(
    row: Record<string, unknown>,
  ): string | undefined {
    const code = resolveOrderOperatingRegionCode(row);
    return code ? code : undefined;
  }

  private async resolveMaxDeliveryRadiusKmForOrderRow(
    row: Record<string, unknown>,
    user: UserModel,
    resolveSettings: (
      regionCode?: string,
    ) => Promise<
      Awaited<ReturnType<PlatformShippingSettingsService['getPublicSettings']>>
    >,
  ): Promise<number> {
    const regionCode = this.resolveStoreRegionCodeFromOrderRow(row) ??
      resolvePlatformShippingRegionCode([user.appCountryCode]);
    const settings = await resolveSettings(regionCode);
    return settings.maxDeliveryRadiusKm;
  }

  private mapOrderRowForAgent(row: Record<string, unknown>) {
    const id = String(row._id);
    const tail = id.slice(-6).toUpperCase();
    const store =
      row.store && typeof row.store === 'object'
        ? (row.store as {
            name?: string;
            currency?: string;
            address?: unknown;
          })
        : null;
    const storeName = store?.name?.trim() || undefined;
    const storeAddr =
      store?.address && typeof store.address === 'object'
        ? (store.address as Record<string, unknown>)
        : undefined;
    const storeCoords = this.coordsFromAddressLike(storeAddr);
    const snapAddr = this.deliveryAddressFromOrder(row);
    const fallbackAddr = this.defaultUserAddressFromPopulated(row.user);
    const coords = snapAddr?.coords ?? fallbackAddr?.coords;
    const shippingAddress =
      snapAddr?.line ?? fallbackAddr?.line ?? this.shippingLineFromOrder(row);
    let distanceKm: number | undefined;
    if (storeCoords && coords) {
      distanceKm = +haversineDistance(storeCoords, coords).toFixed(2);
    }
    const destLng = coords?.[0];
    const destLat = coords?.[1];
    const storeLat = storeCoords?.[1];
    const storeLng = storeCoords?.[0];
    return {
      id,
      storeId: (() => {
        const st = row.store;
        if (st && typeof st === 'object' && st !== null && '_id' in st) {
          return String((st as { _id: unknown })._id);
        }
        return null;
      })(),
      orderRef: `#AE-${tail}`,
      priceCad: Number(row.totalPrice) || 0,
      shippingPriceCad: Number(row.shippingPrice) || 0,
      currency: this.orderCurrencyFromRow(row, store),
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
      pickupCode: String(row.pickupCode ?? row.pickup_code ?? '')
        .trim()
        .toUpperCase() || null,
      shouldShip: row.shouldShip === true,
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

  private shippingLineFromOrder(order: Record<string, unknown>): string {
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

  private coordsFromAddressLike(addr: unknown): [number, number] | undefined {
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
    const doc = addr as Record<string, unknown>;
    const lat = Number(doc.latitude ?? doc.lat);
    const lng = Number(doc.longitude ?? doc.lng ?? doc.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [lng, lat];
    }
    return undefined;
  }
}
