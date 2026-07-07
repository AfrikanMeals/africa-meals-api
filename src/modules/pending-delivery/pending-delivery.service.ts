import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService, emailHeading, emailInfoPanel, emailKeyValueRows, emailParagraph } from '@modules/mailer/email-template.service';
import { MediasService } from '@modules/medias/medias.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { OrdersService } from '@modules/orders/orders.service';
import { VendorStatusEmailService } from '@modules/vendor-emails/vendor-status-email.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  OrderModel,
  OrderStatusEnum,
} from '@schemas/order.schema';
import {
  PendingDeliveryProofModel,
  PendingDeliveryProofStatusEnum,
} from '@schemas/pending-delivery-proof.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { mongoIdsEqual, objectIdStringFromRef } from '@utils/mongoose-ref.util';
import {
  distanceMetersBetweenPoints,
  formatDistanceMetersLabel,
  isMeaningfulGeoCoordinate,
} from './pending-delivery.util';

const MAX_PROOF_PHOTOS = 5;
const MIN_PROOF_PHOTOS = 1;

@Injectable()
export class PendingDeliveryService {
  private readonly logger = new Logger(PendingDeliveryService.name);

  constructor(
    @InjectModel(PendingDeliveryProofModel.name)
    private readonly proofModel: Model<PendingDeliveryProofModel>,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    private readonly medias: MediasService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    private readonly vendorEmails: VendorStatusEmailService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}

  async previewCustomerAbsent(args: {
    user: UserModel;
    orderId: string;
    courierLat: number;
    courierLng: number;
  }) {
    const order = await this.loadAssignedDeliveryOrder(
      args.user,
      args.orderId,
    );
    const dest = this.deliveryCoordsFromOrder(order);
    if (!dest) {
      throw new BadRequestException('delivery_address_coords_missing');
    }
    if (
      !isMeaningfulGeoCoordinate(args.courierLat, args.courierLng)
    ) {
      throw new BadRequestException('courier_location_invalid');
    }
    const distanceMeters = distanceMetersBetweenPoints({
      fromLat: args.courierLat,
      fromLng: args.courierLng,
      toLat: dest.lat,
      toLng: dest.lng,
    });
    return {
      orderId: String(order._id),
      orderRef: this.orderRefFromDoc(order),
      shippingAddress: this.shippingLineFromOrder(order),
      deliveryAddressLat: dest.lat,
      deliveryAddressLng: dest.lng,
      courierLat: args.courierLat,
      courierLng: args.courierLng,
      distanceMeters,
      distanceLabel: formatDistanceMetersLabel(distanceMeters),
      storeName: this.storeNameFromOrder(order),
      customerName: this.customerNameFromOrder(order),
    };
  }

  async submitCustomerAbsent(args: {
    user: UserModel;
    orderId: string;
    courierLat: number;
    courierLng: number;
    proofFiles: Express.Multer.File[];
  }) {
    const order = await this.loadAssignedDeliveryOrder(
      args.user,
      args.orderId,
    );
    const existing = await this.proofModel
      .findOne({ orderId: order._id })
      .exec();
    if (
      existing &&
      existing.status !== PendingDeliveryProofStatusEnum.ADMIN_REJECTED
    ) {
      throw new BadRequestException('pending_delivery_already_submitted');
    }

    const dest = this.deliveryCoordsFromOrder(order);
    if (!dest) {
      throw new BadRequestException('delivery_address_coords_missing');
    }
    if (
      !isMeaningfulGeoCoordinate(args.courierLat, args.courierLng)
    ) {
      throw new BadRequestException('courier_location_invalid');
    }

    const files = (args.proofFiles ?? []).filter(
      (f) => f?.buffer?.length > 0,
    );
    if (files.length < MIN_PROOF_PHOTOS) {
      throw new BadRequestException('proof_photos_required');
    }
    if (files.length > MAX_PROOF_PHOTOS) {
      throw new BadRequestException('proof_photos_max_exceeded');
    }

    const proofPhotoUrls: string[] = [];
    for (const file of files) {
      const url = await this.medias.upload(
        file,
        args.user,
        'delivery-proof',
      );
      const normalized = String(url ?? '').trim();
      if (normalized) proofPhotoUrls.push(normalized);
    }
    if (proofPhotoUrls.length < MIN_PROOF_PHOTOS) {
      throw new BadRequestException('proof_photos_upload_failed');
    }

    const distanceMeters = distanceMetersBetweenPoints({
      fromLat: args.courierLat,
      fromLng: args.courierLng,
      toLat: dest.lat,
      toLng: dest.lng,
    });

    const storeId = this.storeIdFromOrder(order);
    const customerUserId = this.customerIdFromOrder(order);
    const agentId = objectIdStringFromRef(args.user._id ?? args.user.id);
    if (!storeId || !customerUserId || !agentId) {
      throw new BadRequestException('pending_delivery_context_invalid');
    }

    const payload = {
      orderId: order._id,
      deliveryAgentId: new Types.ObjectId(agentId),
      storeId: new Types.ObjectId(storeId),
      customerUserId: new Types.ObjectId(customerUserId),
      status: PendingDeliveryProofStatusEnum.SUBMITTED,
      deliveryAddressLat: dest.lat,
      deliveryAddressLng: dest.lng,
      courierLat: args.courierLat,
      courierLng: args.courierLng,
      distanceMeters,
      proofPhotoUrls,
      shippingAddressLine: this.shippingLineFromOrder(order),
      orderRef: this.orderRefFromDoc(order),
    };

    const proof = existing
      ? await this.proofModel
          .findByIdAndUpdate(existing._id, payload, { new: true })
          .exec()
      : await this.proofModel.create(payload);

    if (!proof) {
      throw new BadRequestException('pending_delivery_save_failed');
    }

    order.pendingDeliveryProofId = new Types.ObjectId(
      String(proof._id),
    ) as unknown as OrderModel['pendingDeliveryProofId'];
    await order.save();

    void this.sendSubmissionEmails({
      proof,
      order,
      storeId,
      customerUserId,
    }).catch((err) =>
      this.logger.warn(
        `pending delivery emails order=${String(order._id)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );

    this.ordersService.notifyOrderPartiesRealtime(order, order.status, {
      pendingDeliveryProofStatus: proof.status,
    } as Record<string, unknown>);

    return {
      proofId: String(proof._id),
      orderId: String(order._id),
      status: proof.status,
      distanceMeters,
      distanceLabel: formatDistanceMetersLabel(distanceMeters),
      proofPhotoCount: proofPhotoUrls.length,
    };
  }

  async confirmByCustomer(args: {
    user: UserModel;
    orderId: string;
    note?: string;
  }) {
    const oid = args.orderId.trim();
    const order = await this.orderModel.findById(oid).exec();
    if (!order) throw new NotFoundException('order_not_found');

    const customerId = this.customerIdFromOrder(order);
    const userId = objectIdStringFromRef(args.user._id ?? args.user.id);
    if (!customerId || !userId || !mongoIdsEqual(customerId, userId)) {
      throw new ForbiddenException('order_not_owned_by_customer');
    }

    const proof = await this.proofModel.findOne({ orderId: order._id }).exec();
    if (!proof) throw new NotFoundException('pending_delivery_not_found');
    if (proof.status !== PendingDeliveryProofStatusEnum.SUBMITTED) {
      throw new BadRequestException('pending_delivery_invalid_status');
    }

    proof.status = PendingDeliveryProofStatusEnum.CUSTOMER_CONFIRMED;
    proof.customerConfirmedAt = new Date();
    proof.customerConfirmNote = args.note?.trim() || undefined;
    await proof.save();

    this.ordersService.notifyOrderPartiesRealtime(order, order.status, {
      pendingDeliveryProofStatus: proof.status,
    } as Record<string, unknown>);

    return {
      proofId: String(proof._id),
      orderId: oid,
      status: proof.status,
    };
  }

  async disputeByCustomer(args: {
    user: UserModel;
    orderId: string;
    note?: string;
  }) {
    const oid = args.orderId.trim();
    const order = await this.orderModel.findById(oid).exec();
    if (!order) throw new NotFoundException('order_not_found');

    const customerId = this.customerIdFromOrder(order);
    const userId = objectIdStringFromRef(args.user._id ?? args.user.id);
    if (!customerId || !userId || !mongoIdsEqual(customerId, userId)) {
      throw new ForbiddenException('order_not_owned_by_customer');
    }

    const proof = await this.proofModel.findOne({ orderId: order._id }).exec();
    if (!proof) throw new NotFoundException('pending_delivery_not_found');
    if (proof.status !== PendingDeliveryProofStatusEnum.SUBMITTED) {
      throw new BadRequestException('pending_delivery_invalid_status');
    }

    proof.status = PendingDeliveryProofStatusEnum.CUSTOMER_DISPUTED;
    proof.customerDisputedAt = new Date();
    proof.customerDisputeNote = args.note?.trim() || undefined;
    await proof.save();

    this.ordersService.notifyOrderPartiesRealtime(order, order.status, {
      pendingDeliveryProofStatus: proof.status,
    } as Record<string, unknown>);

    return {
      proofId: String(proof._id),
      orderId: oid,
      status: proof.status,
    };
  }

  async listForAdmin(user: UserModel, storeId?: string) {
    this.assertAdminAccess(user);
    const filter: Record<string, unknown> = {
      status: {
        $in: [
          PendingDeliveryProofStatusEnum.SUBMITTED,
          PendingDeliveryProofStatusEnum.CUSTOMER_CONFIRMED,
          PendingDeliveryProofStatusEnum.CUSTOMER_DISPUTED,
        ],
      },
    };
    if (storeId?.trim()) {
      filter.storeId = new Types.ObjectId(storeId.trim());
    }

    const rows = await this.proofModel
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate('orderId', 'status totalPrice currency')
      .populate('deliveryAgentId', 'fullName email phoneNumber')
      .populate('customerUserId', 'fullName email phoneNumber')
      .populate('storeId', 'name')
      .exec();

    return rows.map((row) => this.serializeProof(row));
  }

  async reviewByAdmin(args: {
    user: UserModel;
    proofId: string;
    decision: 'approve' | 'reject';
    note?: string;
  }) {
    this.assertAdminAccess(args.user);
    if (!Types.ObjectId.isValid(args.proofId)) {
      throw new NotFoundException('pending_delivery_not_found');
    }

    const proof = await this.proofModel.findById(args.proofId).exec();
    if (!proof) throw new NotFoundException('pending_delivery_not_found');

    if (proof.status !== PendingDeliveryProofStatusEnum.CUSTOMER_CONFIRMED) {
      throw new BadRequestException('pending_delivery_awaiting_customer');
    }

    const adminId = objectIdStringFromRef(args.user._id ?? args.user.id);
    proof.adminReviewedAt = new Date();
    proof.adminReviewedBy = adminId
      ? (new Types.ObjectId(adminId) as unknown as PendingDeliveryProofModel['adminReviewedBy'])
      : undefined;
    proof.adminNote = args.note?.trim() || undefined;

    if (args.decision === 'approve') {
      proof.status = PendingDeliveryProofStatusEnum.ADMIN_APPROVED;
      await proof.save();
      await this.ordersService.completeDeliveryFromPendingProof({
        orderId: String(proof.orderId),
        actorUserId: adminId,
        note: 'Livraison validée (client absent, preuve photo)',
      });
      return {
        proofId: String(proof._id),
        status: proof.status,
        orderCompleted: true,
      };
    }

    proof.status = PendingDeliveryProofStatusEnum.ADMIN_REJECTED;
    await proof.save();

    const order = await this.orderModel.findById(proof.orderId).exec();
    if (order) {
      this.ordersService.notifyOrderPartiesRealtime(order, order.status, {
        pendingDeliveryProofStatus: proof.status,
      } as Record<string, unknown>);
    }

    return {
      proofId: String(proof._id),
      status: proof.status,
      orderCompleted: false,
    };
  }

  async getProofForOrder(orderId: string, user: UserModel) {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new NotFoundException('pending_delivery_not_found');
    }
    const proof = await this.proofModel
      .findOne({ orderId: new Types.ObjectId(orderId) })
      .exec();
    if (!proof) return null;

    const userId = objectIdStringFromRef(user._id ?? user.id);
    const isAdmin = user.type === UserTypeEnum.ADMIN;
    const isCustomer = mongoIdsEqual(proof.customerUserId, userId);
    const isAgent = mongoIdsEqual(proof.deliveryAgentId, userId);
    if (!isAdmin && !isCustomer && !isAgent) {
      throw new ForbiddenException('pending_delivery_access_denied');
    }
    return this.serializeProof(proof);
  }

  private async loadAssignedDeliveryOrder(user: UserModel, orderId: string) {
    if (user.type !== UserTypeEnum.DELIVERY) {
      throw new ForbiddenException('delivery_agent_only');
    }
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }
    const agentId = objectIdStringFromRef(user._id ?? user.id);
    if (!agentId) throw new ForbiddenException('delivery_agent_only');

    const order = await this.orderModel
      .findById(new Types.ObjectId(oid))
      .populate('store', 'name')
      .populate('user', 'fullName')
      .exec();
    if (!order) throw new NotFoundException('order_not_found');
    if (order.shouldShip !== true) {
      throw new BadRequestException('delivery_only');
    }
    if (order.status !== OrderStatusEnum.SHIPPED) {
      throw new BadRequestException('delivery_confirm_invalid_status');
    }
    if (!mongoIdsEqual(order.assignedDeliveryUser, agentId)) {
      throw new ForbiddenException('order_not_assigned_to_agent');
    }
    return order;
  }

  private deliveryCoordsFromOrder(
    order: OrderModel,
  ): { lat: number; lng: number } | null {
    const snap = order.deliveryAddressSnapshot as
      | { location?: { coordinates?: number[] } }
      | undefined;
    const coords = snap?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!isMeaningfulGeoCoordinate(lat, lng)) return null;
    return { lat, lng };
  }

  private shippingLineFromOrder(order: OrderModel): string {
    const snap = order.deliveryAddressSnapshot as
      | {
          address?: string;
          city?: string;
          zipCode?: string;
        }
      | undefined;
    if (!snap) return '—';
    const parts = [
      String(snap.address ?? '').trim(),
      [String(snap.city ?? '').trim(), String(snap.zipCode ?? '').trim()]
        .filter(Boolean)
        .join(' '),
    ].filter(Boolean);
    return parts.join(', ') || '—';
  }

  private orderRefFromDoc(order: OrderModel): string {
    const id = String(order._id ?? '');
    const tail = id.slice(-6).toUpperCase();
    return `#AE-${tail}`;
  }

  private storeNameFromOrder(order: OrderModel): string | null {
    const store = order.store as { name?: string } | undefined;
    const name = store?.name?.trim();
    return name || null;
  }

  private customerNameFromOrder(order: OrderModel): string | null {
    const user = order.user as { fullName?: string } | undefined;
    const name = user?.fullName?.trim();
    return name || null;
  }

  private storeIdFromOrder(order: OrderModel): string | undefined {
    return objectIdStringFromRef(order.store);
  }

  private customerIdFromOrder(order: OrderModel): string | undefined {
    return objectIdStringFromRef(order.user);
  }

  private assertAdminAccess(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  private serializeProof(proof: PendingDeliveryProofModel) {
    const orderPop = proof.orderId as
      | { _id?: unknown; status?: string; totalPrice?: number; currency?: string }
      | undefined;
    const agentPop = proof.deliveryAgentId as
      | { fullName?: string; email?: string; phoneNumber?: string }
      | undefined;
    const customerPop = proof.customerUserId as
      | { fullName?: string; email?: string; phoneNumber?: string }
      | undefined;
    const storePop = proof.storeId as { name?: string } | undefined;

    return {
      id: String(proof._id),
      orderId: objectIdStringFromRef(proof.orderId) ?? String(proof.orderId),
      orderRef: proof.orderRef ?? null,
      status: proof.status,
      shippingAddressLine: proof.shippingAddressLine ?? null,
      deliveryAddressLat: proof.deliveryAddressLat,
      deliveryAddressLng: proof.deliveryAddressLng,
      courierLat: proof.courierLat,
      courierLng: proof.courierLng,
      distanceMeters: proof.distanceMeters,
      distanceLabel: formatDistanceMetersLabel(proof.distanceMeters),
      proofPhotoUrls: proof.proofPhotoUrls ?? [],
      customerConfirmedAt: proof.customerConfirmedAt ?? null,
      customerConfirmNote: proof.customerConfirmNote ?? null,
      customerDisputedAt: proof.customerDisputedAt ?? null,
      customerDisputeNote: proof.customerDisputeNote ?? null,
      adminReviewedAt: proof.adminReviewedAt ?? null,
      adminNote: proof.adminNote ?? null,
      createdAt: (proof as { createdAt?: Date }).createdAt ?? null,
      updatedAt: (proof as { updatedAt?: Date }).updatedAt ?? null,
      orderStatus:
        orderPop && typeof orderPop === 'object' && 'status' in orderPop
          ? orderPop.status
          : null,
      orderTotalPrice:
        orderPop && typeof orderPop === 'object' && 'totalPrice' in orderPop
          ? orderPop.totalPrice
          : null,
      orderCurrency:
        orderPop && typeof orderPop === 'object' && 'currency' in orderPop
          ? orderPop.currency
          : null,
      deliveryAgentName: agentPop?.fullName?.trim() || null,
      deliveryAgentEmail: agentPop?.email?.trim() || null,
      deliveryAgentPhone: agentPop?.phoneNumber?.trim() || null,
      customerName: customerPop?.fullName?.trim() || null,
      customerEmail: customerPop?.email?.trim() || null,
      customerPhone: customerPop?.phoneNumber?.trim() || null,
      storeName: storePop?.name?.trim() || null,
    };
  }

  private async sendSubmissionEmails(args: {
    proof: PendingDeliveryProofModel;
    order: OrderModel;
    storeId: string;
    customerUserId: string;
  }) {
    const customer = await this.userModel.findById(args.customerUserId).exec();
    const store = await this.storeModel.findById(args.storeId).exec();
    const orderRef = args.proof.orderRef ?? this.orderRefFromDoc(args.order);
    const distanceLabel = formatDistanceMetersLabel(args.proof.distanceMeters);
    const address = args.proof.shippingAddressLine ?? '—';
    const photoCount = args.proof.proofPhotoUrls?.length ?? 0;

    await this.vendorEmails.notifyVendorOrderEvent({
      storeId: args.storeId,
      orderId: String(args.order._id),
      event: 'order_shipped',
      storeName: store?.name,
      totalPrice: Number(args.order.totalPrice) || undefined,
      currency: args.order.currency,
      note: `Client absent — preuve déposée (${photoCount} photo(s), distance ${distanceLabel}). En attente confirmation client.`,
      statusLabel: 'Livraison — client absent',
    });

    const customerEmail = customer?.email?.trim();
    if (customerEmail) {
      const bodyHtml = [
        emailHeading('Votre commande a été déposée'),
        emailParagraph(
          `Bonjour ${customer?.fullName?.trim() || ''}, votre livreur a déposé la commande ${orderRef} à l'adresse indiquée.`,
        ),
        emailInfoPanel(
          emailKeyValueRows([
            { label: 'Commande', value: orderRef },
            { label: 'Adresse', value: address },
            { label: 'Distance livreur ↔ adresse', value: distanceLabel },
          ]),
        ),
        emailParagraph(
          'Merci de confirmer dans l\'application que vous avez bien reçu votre commande.',
        ),
      ].join('');
      const html = await this.emailTpl.wrapBodyAsync(bodyHtml);
      await this.mailer.sendSimple({
        to: customerEmail,
        toName: customer?.fullName?.trim() || undefined,
        subject: `Commande ${orderRef} — confirmez la réception`,
        html,
        logContext: `pending-delivery-customer order=${String(args.order._id)}`,
      });
    }

    if (customer) {
      void this.notifications
        .pushCustomerOrderStatusChanged({
          userId: args.customerUserId,
          orderId: String(args.order._id),
          storeName: store?.name,
          storeId: args.storeId,
          previousStatus: args.order.status,
          newStatus: args.order.status,
        })
        .catch(() => undefined);
    }
  }
}
