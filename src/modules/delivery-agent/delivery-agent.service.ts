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
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { PatchDeliveryAgentApplicationDto } from './dto/delivery-agent-application.dto';
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
import {
  AGENT_LOCATION_EMIT_THROTTLE_MS,
  mapDeliveryPresenceToDomain,
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

  async listPendingOrders(user: UserModel) {
    this.assertDeliveryAgent(user);
    const { maxDeliveryRadiusKm } =
      await this._platformShipping.getPublicSettings(
        String(user.appCountryCode ?? '').trim().toUpperCase() || undefined,
      );
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
        select:
          'name address vendorManagesDeliveryDrivers deliveryAssignmentMode',
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

    const agentId = String(user._id ?? user.id);
    const userStoreIds = new Set(
      await this._storeDeliveryDrivers.listStoreIdsForActiveDriver(agentId),
    );

    const managedStoreRows = await this._stores
      .find({ vendorManagesDeliveryDrivers: true })
      .select('_id deliveryAssignmentMode')
      .lean()
      .exec();
    const managedStoreMap = new Map(
      managedStoreRows.map((s) => [String(s._id), s]),
    );

    const items = mapped.filter((item) => {
      const sid = item.storeId ?? '';
      const managed = sid ? managedStoreMap.get(sid) : undefined;
      if (managed) {
        if (!userStoreIds.has(sid)) return false;
        const mode = String(
          managed.deliveryAssignmentMode ?? StoreDeliveryAssignmentModeEnum.AUTO,
        ).toUpperCase();
        if (mode === StoreDeliveryAssignmentModeEnum.MANUAL) return false;
        return true;
      }
      if (item.distanceKm == null) return false;
      return item.distanceKm <= maxDeliveryRadiusKm + 1e-9;
    });

    return { items, maxDeliveryRadiusKm };
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
        assigned_delivery_user: agentId,
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .sort({ updatedAt: -1 })
      .limit(Math.max(capacity, 1))
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
    const items = rows.map((row) =>
      this.mapOrderRowForAgent(row as Record<string, unknown>),
    );
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
      .select('dashboardAvailability vehicle maxConcurrentOrders')
      .lean()
      .exec();
    if (!app) {
      throw new BadRequestException('delivery_agent_not_approved');
    }
    return app;
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
        (row as unknown as Record<string, unknown>).assigned_delivery_user;
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
        assigned_delivery_user: agentId,
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

    const orderDoc = await this._orders
      .findById(oid)
      .populate(
        'store',
        'name owner address vendorManagesDeliveryDrivers deliveryAssignmentMode',
      )
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

    const prevOrderStatus = orderDoc.status as OrderStatusEnum;
    orderDoc.set('assigned_delivery_user', agentId);
    orderDoc.status = OrderStatusEnum.SHIPPED;
    await orderDoc.save();

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

    this._ordersService.emitOrderShippedFromDoc(orderDoc, {
      prevStatus: prevOrderStatus,
      assignedDeliveryUserId: String(agentId),
      actorUserId: String(agentId),
      source: OrderStatusChangeSourceEnum.DELIVERY_AGENT,
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

    void this.publishPresenceWs(String(agentId), 'order_assigned');

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
    const settings = await this._platformShipping.getPublicSettings(
      String(user.appCountryCode ?? '').trim().toUpperCase() || undefined,
    );
    const agentId = new Types.ObjectId(String(user.id));
    const rows = await this._orders
      .find({
        shouldShip: true,
        assignedDeliveryUser: agentId,
        status: {
          $in: [OrderStatusEnum.SHIPPED, OrderStatusEnum.COMPLETED],
        },
      })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select(
        'shippingPrice currency deliveryTipCents deliveryTipStatus stripeDeliveryTipTransferAmountCents updatedAt store',
      )
      .populate({ path: 'store', select: 'name' })
      .lean()
      .exec();

    let totalDriverEarningCad = 0;
    let totalDriverTipEarningCad = 0;

    const items = rows.map((row) => {
      const id = String(row._id);
      const tail = id.slice(-6).toUpperCase();
      const shippingCad = Number(row.shippingPrice) || 0;
      const currency =
        typeof row.currency === 'string' && row.currency.trim()
          ? row.currency.trim().toUpperCase()
          : 'CAD';
      const driverEarningCad = this.computeDriverEarningFromShipping(
        shippingCad,
        settings,
      );
      const tipCents = Math.max(0, Math.round(Number(row.deliveryTipCents) || 0));
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
      const store =
        row.store && typeof row.store === 'object'
          ? (row.store as { name?: string })
          : null;
      return {
        id,
        orderRef: `#AE-${tail}`,
        storeName: store?.name?.trim() || null,
        currency,
        shippingPriceCad: shippingCad,
        driverEarningCad,
        deliveryTipCents: tipCents,
        deliveryTipStatus: tipStatus,
        driverTipEarningCad,
        driverTotalEarningCad,
        status: String(row.status),
        completedAt:
          (row as { updatedAt?: Date }).updatedAt?.toISOString?.() ?? null,
      };
    });

    return {
      items,
      totals: {
        driverEarningCad: Math.round(totalDriverEarningCad * 100) / 100,
        driverTipEarningCad: Math.round(totalDriverTipEarningCad * 100) / 100,
        driverTotalEarningCad:
          Math.round((totalDriverEarningCad + totalDriverTipEarningCad) * 100) /
          100,
      },
    };
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
      storeId: (() => {
        const st = row.store;
        if (st && typeof st === 'object' && st !== null && '_id' in st) {
          return String((st as { _id: unknown })._id);
        }
        return null;
      })(),
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
    const lat = Number((addr as { latitude?: unknown }).latitude);
    const lng = Number((addr as { longitude?: unknown }).longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [lng, lat];
    }
    return undefined;
  }
}
