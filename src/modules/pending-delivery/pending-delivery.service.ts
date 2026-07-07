import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService, emailHeading, emailInfoPanel, emailKeyValueRows, emailParagraph } from '@modules/mailer/email-template.service';
import { MediasService } from '@modules/medias/medias.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { OrdersService } from '@modules/orders/orders.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
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
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  OrderModel,
  OrderStatusEnum,
} from '@schemas/order.schema';
import { OrderStatusChangeSourceEnum } from '@schemas/order-status-event.schema';
import {
  PendingDeliveryProofModel,
  PendingDeliveryProofStatusEnum,
} from '@schemas/pending-delivery-proof.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { mongoIdsEqual, objectIdStringFromRef } from '@utils/mongoose-ref.util';
import {
  buildPendingDeliveryWsExtra,
  distanceMetersBetweenPoints,
  formatDistanceMetersLabel,
  isMeaningfulGeoCoordinate,
  proofPhotosJsonToMulterFiles,
  type ProofPhotoJsonInput,
} from './pending-delivery.util';
import {
  isPendingDeliveryAutoCloseEligible,
  pendingDeliveryAutoCloseDaysFromEnv,
} from './pending-delivery-auto-close.util';

const MAX_PROOF_PHOTOS = 5;
const MIN_PROOF_PHOTOS = 1;
const DEFAULT_LIST_PAGE_SIZE = 10;
const MAX_LIST_PAGE_SIZE = 100;

const ACTIVE_PROOF_STATUSES = [
  PendingDeliveryProofStatusEnum.SUBMITTED,
  PendingDeliveryProofStatusEnum.CUSTOMER_CONFIRMED,
  PendingDeliveryProofStatusEnum.CUSTOMER_DISPUTED,
] as const;

type PendingDeliveryNotifyParty =
  | 'customer'
  | 'vendor'
  | 'delivery_agent';

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
    private readonly config: ConfigService,
    private readonly storeAccess: StoreAccessService,
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

  async submitCustomerAbsentJson(args: {
    user: UserModel;
    orderId: string;
    courierLat: number;
    courierLng: number;
    proofPhotos: ProofPhotoJsonInput[];
  }) {
    const maxBytes = await this.medias.getMaxFileSizeBytes();
    let proofFiles: Express.Multer.File[];
    try {
      proofFiles = proofPhotosJsonToMulterFiles(args.proofPhotos, maxBytes);
    } catch (err) {
      const code =
        err instanceof Error && err.message ? err.message : 'invalid_base64';
      throw new BadRequestException(code);
    }
    return this.submitCustomerAbsent({
      user: args.user,
      orderId: args.orderId,
      courierLat: args.courierLat,
      courierLng: args.courierLng,
      proofFiles,
    });
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
    const agentId = objectIdStringFromRef(args.user._id ?? args.user.id);
    if (!agentId) throw new ForbiddenException('delivery_agent_only');

    const existing = await this.proofModel
      .findOne({ orderId: order._id })
      .exec();
    if (
      existing &&
      existing.status !== PendingDeliveryProofStatusEnum.ADMIN_REJECTED
    ) {
      if (order.status === OrderStatusEnum.COMPLETED) {
        return {
          proofId: String(existing._id),
          orderId: String(order._id),
          status: existing.status,
          orderStatus: OrderStatusEnum.COMPLETED,
          orderCompleted: true,
          pickedUpAt: order.pickedUpAt ?? new Date(),
          distanceMeters: existing.distanceMeters,
          distanceLabel: formatDistanceMetersLabel(existing.distanceMeters),
          proofPhotoCount: existing.proofPhotoUrls?.length ?? 0,
        };
      }
      // Commande encore expédiée : le livreur assigné est déjà validé par
      // loadAssignedDeliveryOrder — remplacer / compléter la preuve (retry, timeout,
      // réassignation avec ancien deliveryAgentId sur la preuve).
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

    const proofPhotoUrls = (
      await this.medias.uploadDeliveryProofBatch(files, args.user)
    ).filter(Boolean);
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

    let proof = existing
      ? await this.proofModel
          .findByIdAndUpdate(existing._id, payload, { new: true })
          .exec()
      : null;

    if (!proof) {
      try {
        proof = await this.proofModel.create(payload);
      } catch (err) {
        if (this.isMongoDuplicateKey(err)) {
          const duplicate = await this.proofModel
            .findOne({ orderId: order._id })
            .exec();
          if (
            duplicate &&
            duplicate.status !== PendingDeliveryProofStatusEnum.ADMIN_REJECTED
          ) {
            const orderId = String(order._id);
            this.emitPendingDeliveryRealtime(order, duplicate, storeId);
            return {
              proofId: String(duplicate._id),
              orderId,
              status: duplicate.status,
              orderStatus: order.status,
              orderCompleted: false,
              distanceMeters: duplicate.distanceMeters,
              distanceLabel: formatDistanceMetersLabel(
                duplicate.distanceMeters,
              ),
              proofPhotoCount: duplicate.proofPhotoUrls?.length ?? 0,
            };
          }
        }
        throw err;
      }
    }

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

    this.emitPendingDeliveryRealtime(order, proof, storeId);

    return {
      proofId: String(proof._id),
      orderId: String(order._id),
      status: proof.status,
      orderStatus: order.status,
      orderCompleted: false,
      distanceMeters,
      distanceLabel: formatDistanceMetersLabel(distanceMeters),
      proofPhotoCount: proofPhotoUrls.length,
    };
  }

  /** WS + staff broadcast : nouvelle preuve ou changement de statut. */
  private emitPendingDeliveryRealtime(
    order: OrderModel,
    proof: Pick<PendingDeliveryProofModel, '_id' | 'status'>,
    storeId?: string | null,
  ): void {
    const sid =
      storeId?.trim() ||
      objectIdStringFromRef(
        (proof as { storeId?: unknown }).storeId,
      ) ||
      this.storeIdFromOrder(order);
    this.ordersService.notifyOrderPartiesRealtime(
      order,
      order.status as OrderStatusEnum,
      buildPendingDeliveryWsExtra({
        proofId: String(proof._id),
        status: String(proof.status),
        storeId: sid,
      }),
    );
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

    this.emitPendingDeliveryRealtime(order, proof);

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

    this.emitPendingDeliveryRealtime(order, proof);

    return {
      proofId: String(proof._id),
      orderId: oid,
      status: proof.status,
    };
  }

  async listPendingDeliveries(
    user: UserModel,
    args: { storeId?: string; page?: number; limit?: number },
  ) {
    const pageSize = Math.min(
      Math.max(args.limit ?? DEFAULT_LIST_PAGE_SIZE, 1),
      MAX_LIST_PAGE_SIZE,
    );
    const page = Math.max(args.page ?? 1, 1);
    const skip = (page - 1) * pageSize;
    const filter = await this.buildListFilter(user, args.storeId);

    const [total, rows] = await Promise.all([
      this.proofModel.countDocuments(filter).exec(),
      this.proofModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('orderId', 'status totalPrice currency')
        .populate('deliveryAgentId', 'fullName email phoneNumber')
        .populate('customerUserId', 'fullName email phoneNumber')
        .populate({
          path: 'storeId',
          select: 'name email owner',
          populate: { path: 'owner', select: 'email fullName' },
        })
        .exec(),
    ]);

    return {
      items: rows.map((row) => this.serializeProof(row)),
      total,
      page,
      pageSize,
    };
  }

  /** @deprecated Utiliser listPendingDeliveries */
  async listForAdmin(user: UserModel, storeId?: string) {
    const result = await this.listPendingDeliveries(user, {
      storeId,
      page: 1,
      limit: 200,
    });
    return result.items;
  }

  async notifyThirdPartiesByAdmin(args: {
    user: UserModel;
    proofId: string;
    recipients: PendingDeliveryNotifyParty[];
    subject?: string;
    htmlBody?: string;
  }) {
    this.assertAdminAccess(args.user);
    const proof = await this.loadProofById(args.proofId);
    this.assertProofIsActive(proof);

    const order = await this.orderModel.findById(proof.orderId).exec();
    if (!order) throw new NotFoundException('order_not_found');

    const storeId = objectIdStringFromRef(proof.storeId);
    const customerUserId = objectIdStringFromRef(proof.customerUserId);
    if (!storeId || !customerUserId) {
      throw new BadRequestException('pending_delivery_context_invalid');
    }

    const notified = await this.sendSelectedPartyEmails({
      proof,
      order,
      storeId,
      customerUserId,
      recipients: args.recipients,
      subject: args.subject,
      htmlBody: args.htmlBody,
      reminder: true,
    });

    return {
      proofId: String(proof._id),
      notified,
    };
  }

  async closeByAdmin(args: {
    user: UserModel;
    proofId: string;
    note?: string;
  }) {
    this.assertAdminAccess(args.user);
    const proof = await this.loadProofById(args.proofId);
    this.assertProofIsActive(proof);

    const adminId = objectIdStringFromRef(args.user._id ?? args.user.id);
    const adminNote =
      args.note?.trim() ||
      'Clôture manuelle admin — livraison client absent validée.';

    const orderCompleted = await this.finalizePendingProofOrderCompletion({
      proof,
      actorUserId: adminId,
      note: adminNote,
    });

    proof.status = PendingDeliveryProofStatusEnum.ADMIN_APPROVED;
    proof.adminReviewedAt = new Date();
    proof.adminReviewedBy = adminId
      ? (new Types.ObjectId(adminId) as unknown as PendingDeliveryProofModel['adminReviewedBy'])
      : undefined;
    proof.adminNote = adminNote;
    await proof.save();

    const order = await this.orderModel.findById(proof.orderId).exec();
    if (order) {
      this.emitPendingDeliveryRealtime(order, proof);
    }

    return {
      proofId: String(proof._id),
      status: proof.status,
      orderCompleted,
    };
  }

  async runAutoClosePass(): Promise<{
    scanned: number;
    closed: number;
    failed: number;
  }> {
    const autoCloseDays = pendingDeliveryAutoCloseDaysFromEnv(
      this.config.get<string>('PENDING_DELIVERY_AUTO_CLOSE_DAYS'),
    );
    const cutoff = new Date(
      Date.now() - autoCloseDays * 24 * 60 * 60 * 1000,
    );

    const candidates = await this.proofModel
      .find({
        status: PendingDeliveryProofStatusEnum.SUBMITTED,
        createdAt: { $lte: cutoff },
      })
      .limit(200)
      .exec();

    let closed = 0;
    let failed = 0;

    for (const proof of candidates) {
      if (
        !isPendingDeliveryAutoCloseEligible({
          status: proof.status,
          createdAt: (proof as { createdAt?: Date }).createdAt,
          autoCloseDays,
        })
      ) {
        continue;
      }

      try {
        const adminNote = `Clôture automatique — aucune confirmation client sous ${autoCloseDays} jour(s).`;
        const orderCompleted = await this.finalizePendingProofOrderCompletion({
          proof,
          note: adminNote,
        });

        proof.status = PendingDeliveryProofStatusEnum.ADMIN_APPROVED;
        proof.adminReviewedAt = new Date();
        proof.adminNote = adminNote;
        await proof.save();

        const order = await this.orderModel.findById(proof.orderId).exec();
        if (order) {
          this.emitPendingDeliveryRealtime(order, proof);
        }

        if (!orderCompleted) {
          this.logger.warn(
            `pending delivery auto-close proof=${String(proof._id)}: proof closed without order completion`,
          );
        }

        const storeId = objectIdStringFromRef(proof.storeId);
        const customerUserId = objectIdStringFromRef(proof.customerUserId);
        if (order && storeId && customerUserId) {
          await this.sendThirdPartyEmails({
            proof,
            order,
            storeId,
            customerUserId,
            reminder: true,
            autoClosed: true,
            autoCloseDays,
          });
        }

        closed += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `pending delivery auto-close proof=${String(proof._id)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      scanned: candidates.length,
      closed,
      failed,
    };
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
      const orderCompleted = await this.finalizePendingProofOrderCompletion({
        proof,
        actorUserId: adminId,
        note: 'Livraison validée (client absent, preuve photo)',
      });

      proof.status = PendingDeliveryProofStatusEnum.ADMIN_APPROVED;
      await proof.save();

      const order = await this.orderModel.findById(proof.orderId).exec();
      if (order) {
        this.emitPendingDeliveryRealtime(order, proof);
      }

      return {
        proofId: String(proof._id),
        status: proof.status,
        orderCompleted,
      };
    }

    proof.status = PendingDeliveryProofStatusEnum.ADMIN_REJECTED;
    await proof.save();

    const order = await this.orderModel.findById(proof.orderId).exec();
    if (order) {
      this.emitPendingDeliveryRealtime(order, proof);
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
    const storePop = proof.storeId as
      | {
          name?: string;
          email?: string;
          owner?: { email?: string; fullName?: string };
        }
      | undefined;

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
      storeEmail: this.storeNotifyEmailFromPop(storePop),
    };
  }

  private storeNotifyEmailFromPop(
    storePop:
      | {
          email?: string;
          owner?: { email?: string };
        }
      | undefined,
  ): string | null {
    const storeEmail = storePop?.email?.trim();
    if (storeEmail) return storeEmail;
    const ownerEmail = storePop?.owner?.email?.trim();
    return ownerEmail || null;
  }

  private async resolveStoreNotifyTarget(
    storeId: string,
  ): Promise<{ email: string; name?: string } | null> {
    const store = await this.storeModel
      .findById(storeId)
      .select('name email owner')
      .populate('owner', 'email fullName')
      .exec();
    if (!store) return null;

    const ownerPop = store.owner as
      | { email?: string; fullName?: string }
      | undefined;
    const email =
      store.email?.trim() || ownerPop?.email?.trim() || '';
    if (!email) return null;

    return {
      email,
      name: store.name?.trim() || ownerPop?.fullName?.trim() || undefined,
    };
  }

  private async finalizePendingProofOrderCompletion(args: {
    proof: PendingDeliveryProofModel;
    actorUserId?: string;
    note?: string;
  }): Promise<boolean> {
    const order = await this.orderModel.findById(args.proof.orderId).exec();
    if (!order) return false;

    const status = order.status as OrderStatusEnum;
    if (status === OrderStatusEnum.COMPLETED) return true;

    if (status !== OrderStatusEnum.SHIPPED) {
      this.logger.warn(
        `Pending delivery proof ${String(args.proof._id)}: order ${String(order._id)} status=${status} — skipping order completion`,
      );
      return false;
    }

    await this.ordersService.completeDeliveryFromPendingProof({
      orderId: String(args.proof.orderId),
      actorUserId: args.actorUserId,
      note: args.note,
    });
    return true;
  }

  private async sendSubmissionEmails(args: {
    proof: PendingDeliveryProofModel;
    order: OrderModel;
    storeId: string;
    customerUserId: string;
  }) {
    await this.sendThirdPartyEmails({
      proof: args.proof,
      order: args.order,
      storeId: args.storeId,
      customerUserId: args.customerUserId,
      reminder: false,
    });
  }

  private async sendSelectedPartyEmails(args: {
    proof: PendingDeliveryProofModel;
    order: OrderModel;
    storeId: string;
    customerUserId: string;
    recipients: PendingDeliveryNotifyParty[];
    subject?: string;
    htmlBody?: string;
    reminder?: boolean;
    autoClosed?: boolean;
    autoCloseDays?: number;
  }): Promise<PendingDeliveryNotifyParty[]> {
    const uniqueRecipients = [...new Set(args.recipients)];
    const notified: PendingDeliveryNotifyParty[] = [];
    const customHtml = args.htmlBody?.trim();
    const orderRef = args.proof.orderRef ?? this.orderRefFromDoc(args.order);

    if (customHtml) {
      const subject =
        args.subject?.trim() ||
        `Commande ${orderRef} — livraison client absent`;
      const html = await this.emailTpl.wrapBodyAsync(customHtml);

      for (const party of uniqueRecipients) {
        const target = await this.resolvePartyEmailTarget(party, args);
        if (!target?.email) continue;
        await this.mailer.sendSimple({
          to: target.email,
          toName: target.name,
          subject,
          html,
          logContext: `pending-delivery-admin party=${party} order=${String(args.order._id)}`,
        });
        notified.push(party);
      }
    } else {
      for (const party of uniqueRecipients) {
        const sent = await this.sendDefaultPartyEmail({
          proof: args.proof,
          order: args.order,
          storeId: args.storeId,
          customerUserId: args.customerUserId,
          party,
          orderRef,
          reminder: args.reminder,
          autoClosed: args.autoClosed,
          autoCloseDays: args.autoCloseDays,
        });
        if (sent) notified.push(party);
      }
    }

    if (notified.length === 0) {
      throw new BadRequestException('pending_delivery_no_recipient_email');
    }

    return notified;
  }

  private async resolvePartyEmailTarget(
    party: PendingDeliveryNotifyParty,
    args: {
      proof: PendingDeliveryProofModel;
      storeId: string;
      customerUserId: string;
    },
  ): Promise<{ email: string; name?: string } | null> {
    if (party === 'customer') {
      const customer = await this.userModel.findById(args.customerUserId).exec();
      const email = customer?.email?.trim();
      return email ? { email, name: customer?.fullName?.trim() } : null;
    }
    if (party === 'delivery_agent') {
      const agentId = objectIdStringFromRef(args.proof.deliveryAgentId);
      const agent = agentId
        ? await this.userModel.findById(agentId).exec()
        : null;
      const email = agent?.email?.trim();
      return email ? { email, name: agent?.fullName?.trim() } : null;
    }
    const storeTarget = await this.resolveStoreNotifyTarget(args.storeId);
    return storeTarget;
  }

  private async sendDefaultPartyEmail(args: {
    proof: PendingDeliveryProofModel;
    order: OrderModel;
    storeId: string;
    customerUserId: string;
    party: PendingDeliveryNotifyParty;
    orderRef: string;
    reminder?: boolean;
    autoClosed?: boolean;
    autoCloseDays?: number;
  }): Promise<boolean> {
    const distanceLabel = formatDistanceMetersLabel(args.proof.distanceMeters);
    const address = args.proof.shippingAddressLine ?? '—';
    const photoCount = args.proof.proofPhotoUrls?.length ?? 0;

    if (args.party === 'vendor') {
      const vendorNote = args.autoClosed
        ? `Clôture automatique après ${args.autoCloseDays ?? 7} jour(s) sans confirmation client (${photoCount} photo(s), distance ${distanceLabel}).`
        : args.reminder
          ? `Rappel — livraison client absent (${photoCount} photo(s), distance ${distanceLabel}).`
          : `Client absent — preuve déposée (${photoCount} photo(s), distance ${distanceLabel}). En attente confirmation client.`;
      const store = await this.storeModel.findById(args.storeId).exec();
      await this.vendorEmails.notifyVendorOrderEvent({
        storeId: args.storeId,
        orderId: String(args.order._id),
        event: 'order_shipped',
        storeName: store?.name,
        totalPrice: Number(args.order.totalPrice) || undefined,
        currency: args.order.currency,
        note: vendorNote,
        statusLabel: args.autoClosed
          ? 'Livraison clôturée automatiquement'
          : 'Livraison — client absent',
      });
      return true;
    }

    if (args.party === 'customer') {
      const customer = await this.userModel.findById(args.customerUserId).exec();
      const customerEmail = customer?.email?.trim();
      if (!customerEmail) return false;

      const heading = args.autoClosed
        ? 'Votre commande a été clôturée'
        : args.reminder
          ? 'Rappel — confirmez la réception'
          : 'Votre commande a été déposée';
      const intro = args.autoClosed
        ? `Bonjour ${customer?.fullName?.trim() || ''}, faute de confirmation sous ${args.autoCloseDays ?? 7} jour(s), la commande ${args.orderRef} déposée à l'adresse indiquée a été clôturée automatiquement.`
        : args.reminder
          ? `Bonjour ${customer?.fullName?.trim() || ''}, nous vous rappelons de confirmer la réception de la commande ${args.orderRef} déposée à l'adresse indiquée.`
          : `Bonjour ${customer?.fullName?.trim() || ''}, votre livreur a déposé la commande ${args.orderRef} à l'adresse indiquée.`;

      const bodyHtml = [
        emailHeading(heading),
        emailParagraph(intro),
        emailInfoPanel(
          emailKeyValueRows([
            { label: 'Commande', value: args.orderRef },
            { label: 'Adresse', value: address },
            { label: 'Distance livreur ↔ adresse', value: distanceLabel },
          ]),
        ),
        emailParagraph(
          args.autoClosed
            ? 'Si vous n\'avez pas reçu votre commande, contactez le support depuis l\'application.'
            : 'Merci de confirmer dans l\'application que vous avez bien reçu votre commande.',
        ),
      ].join('');
      const html = await this.emailTpl.wrapBodyAsync(bodyHtml);
      const subject = args.autoClosed
        ? `Commande ${args.orderRef} — clôturée automatiquement`
        : args.reminder
          ? `Commande ${args.orderRef} — rappel de confirmation`
          : `Commande ${args.orderRef} — confirmez la réception`;
      await this.mailer.sendSimple({
        to: customerEmail,
        toName: customer?.fullName?.trim() || undefined,
        subject,
        html,
        logContext: `pending-delivery-customer order=${String(args.order._id)} reminder=${args.reminder ? '1' : '0'}`,
      });
      return true;
    }

    if (args.party === 'delivery_agent') {
      const agentId = objectIdStringFromRef(args.proof.deliveryAgentId);
      const agent = agentId
        ? await this.userModel.findById(agentId).exec()
        : null;
      const agentEmail = agent?.email?.trim();
      if (!agentEmail) return false;

      const intro = args.reminder
        ? `Bonjour ${agent?.fullName?.trim() || ''}, rappel concernant la livraison client absent pour la commande ${args.orderRef}.`
        : `Bonjour ${agent?.fullName?.trim() || ''}, la livraison client absent pour la commande ${args.orderRef} a été enregistrée.`;
      const bodyHtml = [
        emailHeading('Livraison client absent'),
        emailParagraph(intro),
        emailInfoPanel(
          emailKeyValueRows([
            { label: 'Commande', value: args.orderRef },
            { label: 'Adresse', value: address },
            { label: 'Distance', value: distanceLabel },
            { label: 'Photos', value: String(photoCount) },
          ]),
        ),
      ].join('');
      const html = await this.emailTpl.wrapBodyAsync(bodyHtml);
      const subject = `Commande ${args.orderRef} — livraison client absent`;
      await this.mailer.sendSimple({
        to: agentEmail,
        toName: agent?.fullName?.trim() || undefined,
        subject,
        html,
        logContext: `pending-delivery-agent order=${String(args.order._id)} reminder=${args.reminder ? '1' : '0'}`,
      });
      return true;
    }

    return false;
  }

  private async sendThirdPartyEmails(args: {
    proof: PendingDeliveryProofModel;
    order: OrderModel;
    storeId: string;
    customerUserId: string;
    reminder?: boolean;
    autoClosed?: boolean;
    autoCloseDays?: number;
  }) {
    await this.sendSelectedPartyEmails({
      proof: args.proof,
      order: args.order,
      storeId: args.storeId,
      customerUserId: args.customerUserId,
      recipients: ['customer', 'vendor'],
      reminder: args.reminder,
      autoClosed: args.autoClosed,
      autoCloseDays: args.autoCloseDays,
    });

    const customer = await this.userModel.findById(args.customerUserId).exec();
    const store = await this.storeModel.findById(args.storeId).exec();
    if (customer && !args.reminder && !args.autoClosed) {
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

  private async buildListFilter(user: UserModel, storeId?: string) {
    const filter: Record<string, unknown> = {
      status: { $in: [...ACTIVE_PROOF_STATUSES] },
    };

    if (user.type === UserTypeEnum.ADMIN) {
      if (storeId?.trim()) {
        if (!Types.ObjectId.isValid(storeId.trim())) {
          throw new BadRequestException('invalid_store_id');
        }
        filter.storeId = new Types.ObjectId(storeId.trim());
      }
      return filter;
    }

    if (user.type === UserTypeEnum.VENDOR) {
      const sid = storeId?.trim();
      if (!sid || !Types.ObjectId.isValid(sid)) {
        throw new BadRequestException('store_id_required');
      }
      await this.storeAccess.assertStoreAccess(user, sid, 'orders.view');
      filter.storeId = new Types.ObjectId(sid);
      return filter;
    }

    throw new ForbiddenException('access_denied');
  }

  private async loadProofById(proofId: string) {
    if (!Types.ObjectId.isValid(proofId)) {
      throw new NotFoundException('pending_delivery_not_found');
    }
    const proof = await this.proofModel.findById(proofId).exec();
    if (!proof) throw new NotFoundException('pending_delivery_not_found');
    return proof;
  }

  private assertProofIsActive(proof: PendingDeliveryProofModel) {
    if (!ACTIVE_PROOF_STATUSES.includes(proof.status as (typeof ACTIVE_PROOF_STATUSES)[number])) {
      throw new BadRequestException('pending_delivery_not_active');
    }
  }

  private isMongoDuplicateKey(err: unknown): boolean {
    const code = (err as { code?: number })?.code;
    return code === 11000 || code === 11001;
  }
}
