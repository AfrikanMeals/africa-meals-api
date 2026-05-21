import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MailerService } from '@modules/mailer/mailer.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { OrdersService } from '@modules/orders/orders.service';
import { StripeConnectTransferService } from '@modules/billing/stripe/stripe-connect-transfer.service';
import { PlatformFeesService } from '@modules/platform-fees/platform-fees.service';
import {
  OrderModel,
  OrderRefundRequestEntryStatusEnum,
  OrderStatusEnum,
} from '@schemas/order.schema';
import {
  RefundProcessingSettingsModel,
} from '@schemas/refund-processing-settings.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { StripeRefundService } from './stripe-refund.service';

const SETTINGS_KEY = 'default';
const AUTO_DELAY_MINUTES = Math.max(
  1,
  parseInt(process.env.REFUND_AUTO_PROCESS_DELAY_MINUTES ?? '15', 10) || 15,
);

export type RefundQueueItem = {
  orderId: string;
  orderNumber: string;
  requestedAt: string;
  status: OrderRefundRequestEntryStatusEnum;
  details: string;
  resolutionNote?: string;
  stripeRefundId?: string;
  refundGrossCents?: number;
  platformRefundFeeCents?: number;
  customerRefundCents?: number;
  totalPrice: number;
  shippingPrice: number;
  stripeParentPaymentId?: string;
  orderStatus: string;
  customer: { id: string; fullName: string; email: string };
  store: { id: string; name: string };
  canProcess: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
};

export type RefundListResponse = {
  processingPaused: boolean;
  autoProcessDelayMinutes: number;
  items: RefundQueueItem[];
};

const ACTIVE_REFUND_STATUSES: OrderRefundRequestEntryStatusEnum[] = [
  OrderRefundRequestEntryStatusEnum.PENDING,
  OrderRefundRequestEntryStatusEnum.PAUSED,
  OrderRefundRequestEntryStatusEnum.APPROVED,
];

const ALL_REFUND_STATUSES: OrderRefundRequestEntryStatusEnum[] = [
  OrderRefundRequestEntryStatusEnum.PENDING,
  OrderRefundRequestEntryStatusEnum.PAUSED,
  OrderRefundRequestEntryStatusEnum.APPROVED,
  OrderRefundRequestEntryStatusEnum.REJECTED,
  OrderRefundRequestEntryStatusEnum.COMPLETED,
];

function assertAdmin(user: UserModel): void {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

/** Journal remboursement (lean Mongo = `refund_request_log`, documents Mongoose = `refundRequestLog`). */
function refundLogFromOrderDoc(
  order: Record<string, unknown> | OrderModel,
): NonNullable<OrderModel['refundRequestLog']> {
  const o = order as Record<string, unknown>;
  const raw =
    o.refundRequestLog ?? o.refund_request_log ?? o['refundRequestLog'];
  return Array.isArray(raw)
    ? (raw as NonNullable<OrderModel['refundRequestLog']>)
    : [];
}

function latestRefundEntry(
  log: OrderModel['refundRequestLog'],
): NonNullable<OrderModel['refundRequestLog']>[number] | null {
  if (!log?.length) return null;
  return log[log.length - 1] ?? null;
}

/** Dernière entrée encore à traiter (pending / paused / approved). */
function activeRefundEntry(
  log: OrderModel['refundRequestLog'],
): NonNullable<OrderModel['refundRequestLog']>[number] | null {
  if (!log?.length) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const row = log[i];
    if (
      row &&
      ACTIVE_REFUND_STATUSES.includes(
        row.status as OrderRefundRequestEntryStatusEnum,
      )
    ) {
      return row;
    }
  }
  return null;
}

function stripeParentIdFromOrder(
  order: Record<string, unknown> | OrderModel,
): string | undefined {
  const o = order as Record<string, unknown>;
  const v = o.stripeParentPaymentId ?? o.stripe_parent_payment_id;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

@Injectable()
export class RefundProcessingService {
  private readonly logger = new Logger(RefundProcessingService.name);

  constructor(
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(RefundProcessingSettingsModel.name)
    private readonly settingsModel: Model<RefundProcessingSettingsModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly stripeRefund: StripeRefundService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(MailerService)
    private readonly mailer: MailerService,
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    private readonly platformFeesService: PlatformFeesService,
    private readonly stripeTransfers: StripeConnectTransferService,
  ) {}

  private async settingsDoc(): Promise<RefundProcessingSettingsModel> {
    let doc = await this.settingsModel.findOne({ key: SETTINGS_KEY }).exec();
    if (!doc) {
      doc = await this.settingsModel.create({
        key: SETTINGS_KEY,
        processingPaused: false,
      });
    }
    return doc;
  }

  async getProcessingSettings(): Promise<{
    processingPaused: boolean;
    pausedAt: string | null;
    autoProcessDelayMinutes: number;
  }> {
    const doc = await this.settingsDoc();
    return {
      processingPaused: Boolean(doc.processingPaused),
      pausedAt: doc.pausedAt ? doc.pausedAt.toISOString() : null,
      autoProcessDelayMinutes: AUTO_DELAY_MINUTES,
    };
  }

  async pauseGlobalProcessing(
    admin: UserModel,
    note?: string,
  ): Promise<{ processingPaused: boolean }> {
    assertAdmin(admin);
    await this.settingsModel.updateOne(
      { key: SETTINGS_KEY },
      {
        $set: {
          processingPaused: true,
          pausedAt: new Date(),
          pausedBy: new Types.ObjectId(String(admin.id)),
          pauseNote: note?.trim()?.slice(0, 500) || undefined,
        },
      },
      { upsert: true },
    );
    return { processingPaused: true };
  }

  async resumeGlobalProcessing(
    admin: UserModel,
  ): Promise<{ processingPaused: boolean }> {
    assertAdmin(admin);
    await this.settingsModel.updateOne(
      { key: SETTINGS_KEY },
      {
        $set: { processingPaused: false },
        $unset: { pausedAt: '', pausedBy: '', pauseNote: '' },
      },
      { upsert: true },
    );
    return { processingPaused: false };
  }

  private async vendorStoreIds(user: UserModel): Promise<Types.ObjectId[]> {
    const uid = new Types.ObjectId(String(user.id));
    const stores = await this.storeModel
      .find({ owner: uid })
      .select('_id')
      .lean()
      .exec();
    return stores.map((s) => s._id as Types.ObjectId);
  }

  async listRefundQueue(user: UserModel): Promise<RefundListResponse> {
    if (
      user.type !== UserTypeEnum.ADMIN &&
      user.type !== UserTypeEnum.VENDOR
    ) {
      throw new ForbiddenException('forbidden');
    }

    const settings = await this.settingsDoc();
    const match: Record<string, unknown> = {
      refundRequestLog: {
        $elemMatch: { status: { $in: ALL_REFUND_STATUSES } },
      },
    };

    if (user.type === UserTypeEnum.VENDOR) {
      const storeIds = await this.vendorStoreIds(user);
      if (!storeIds.length) {
        return {
          processingPaused: settings.processingPaused,
          autoProcessDelayMinutes: AUTO_DELAY_MINUTES,
          items: [],
        };
      }
      match.store = { $in: storeIds };
    }

    const orders = await this.orderModel
      .find(match)
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate('user', 'fullName email')
      .populate('store', 'name')
      .select(
        'status totalPrice shippingPrice stripeParentPaymentId stripeChargedGoodsCents stripeChargedShipCents refundRequestLog user store createdAt',
      )
      .lean()
      .exec();

    const isAdmin = user.type === UserTypeEnum.ADMIN;
    const items: RefundQueueItem[] = [];

    for (const o of orders) {
      const raw = o as Record<string, unknown>;
      const log = refundLogFromOrderDoc(raw);
      const entry = latestRefundEntry(log);
      if (!entry) continue;
      const st = entry.status as OrderRefundRequestEntryStatusEnum;

      const oid = String(o._id);
      const userDoc = o.user as
        | { _id?: Types.ObjectId; fullName?: string; email?: string }
        | undefined;
      const storeDoc = o.store as unknown as
        | { _id?: Types.ObjectId; name?: string }
        | undefined;

      const grossCents = this.refundAmountCents(o as OrderModel);
      let refundGrossCents = entry.refundGrossCents;
      let platformRefundFeeCents = entry.platformRefundFeeCents;
      let customerRefundCents = entry.customerRefundCents;
      if (customerRefundCents == null && grossCents >= 1) {
        const split =
          await this.platformFeesService.computeRefundSplit(grossCents);
        refundGrossCents = split.grossCents;
        platformRefundFeeCents = split.platformFeeCents;
        customerRefundCents = split.customerRefundCents;
      }

      items.push({
        orderId: oid,
        orderNumber: `#AE-${oid.slice(-6).toUpperCase()}`,
        requestedAt: entry.requestedAt
          ? new Date(entry.requestedAt).toISOString()
          : new Date().toISOString(),
        status: st,
        details: entry.details ?? '',
        resolutionNote: entry.resolutionNote,
        stripeRefundId: entry.stripeRefundId,
        refundGrossCents,
        platformRefundFeeCents,
        customerRefundCents,
        totalPrice:
          typeof o.totalPrice === 'number' ? o.totalPrice : 0,
        shippingPrice:
          typeof o.shippingPrice === 'number' ? o.shippingPrice : 0,
        stripeParentPaymentId: stripeParentIdFromOrder(raw),
        orderStatus: String(o.status ?? ''),
        customer: {
          id: userDoc?._id ? String(userDoc._id) : '',
          fullName: userDoc?.fullName?.trim() || '—',
          email: userDoc?.email?.trim() || '',
        },
        store: {
          id: storeDoc?._id ? String(storeDoc._id) : '',
          name: storeDoc?.name?.trim() || '—',
        },
        canProcess:
          isAdmin &&
          (st === OrderRefundRequestEntryStatusEnum.PENDING ||
            st === OrderRefundRequestEntryStatusEnum.APPROVED),
        canPause:
          isAdmin && st === OrderRefundRequestEntryStatusEnum.PENDING,
        canResume:
          isAdmin && st === OrderRefundRequestEntryStatusEnum.PAUSED,
        canCancel:
          isAdmin &&
          (st === OrderRefundRequestEntryStatusEnum.PENDING ||
            st === OrderRefundRequestEntryStatusEnum.PAUSED),
      });
    }

    return {
      processingPaused: settings.processingPaused,
      autoProcessDelayMinutes: AUTO_DELAY_MINUTES,
      items,
    };
  }

  private async loadOrderForRefund(
    orderId: string,
    actor: UserModel,
  ): Promise<OrderModel> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new NotFoundException('order_not_found');
    }
    const order = await this.orderModel
      .findById(orderId)
      .populate('user', 'fullName email')
      .populate('store', 'name owner')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }
    if (actor.type === UserTypeEnum.VENDOR) {
      const storeIds = await this.vendorStoreIds(actor);
      const sid = this.storeIdFromOrder(order);
      if (!sid || !storeIds.some((id) => id.toString() === sid)) {
        throw new ForbiddenException('store_forbidden');
      }
    }
    return order;
  }

  private storeIdFromOrder(order: OrderModel): string | null {
    const s = order.store as StoreModel | Types.ObjectId | string | undefined;
    if (!s) return null;
    if (s instanceof Types.ObjectId) return s.toString();
    if (typeof s === 'object' && '_id' in s) {
      return String((s as { _id: Types.ObjectId })._id);
    }
    return String(s);
  }

  private storeNameFromOrder(order: OrderModel): string {
    const s = order.store as { name?: string } | undefined;
    return s?.name?.trim() || 'Restaurant';
  }

  private customerFromOrder(order: OrderModel): {
    userId: string;
    fullName: string;
    email: string;
  } {
    const u = order.user as
      | { _id?: Types.ObjectId; id?: string; fullName?: string; email?: string }
      | undefined;
    const userId = u?._id
      ? String(u._id)
      : u?.id
        ? String(u.id)
        : String(order.user ?? '');
    return {
      userId,
      fullName: u?.fullName?.trim() || 'Client',
      email: u?.email?.trim() || '',
    };
  }

  private refundAmountCents(order: OrderModel): number {
    const goods = order.stripeChargedGoodsCents ?? 0;
    const ship = order.stripeChargedShipCents ?? 0;
    if (goods + ship > 0) return goods + ship;
    const total = typeof order.totalPrice === 'number' ? order.totalPrice : 0;
    const shipping =
      typeof order.shippingPrice === 'number' ? order.shippingPrice : 0;
    return Math.round((total + shipping) * 100);
  }

  private patchLatestEntry(
    order: OrderModel,
    patch: Partial<
      NonNullable<OrderModel['refundRequestLog']>[number]
    >,
  ): void {
    const log = [...(order.refundRequestLog ?? [])];
    if (!log.length) {
      throw new BadRequestException('refund_entry_missing');
    }
    const idx = log.length - 1;
    log[idx] = { ...log[idx], ...patch };
    order.refundRequestLog = log;
  }

  async pauseRefund(
    admin: UserModel,
    orderId: string,
    note?: string,
  ): Promise<{ orderId: string; status: string }> {
    assertAdmin(admin);
    const order = await this.loadOrderForRefund(orderId, admin);
    const entry = activeRefundEntry(refundLogFromOrderDoc(order));
    if (entry?.status !== OrderRefundRequestEntryStatusEnum.PENDING) {
      throw new BadRequestException('refund_not_pausable');
    }
    this.patchLatestEntry(order, {
      status: OrderRefundRequestEntryStatusEnum.PAUSED,
      resolutionNote: note?.trim()?.slice(0, 500) || entry.resolutionNote,
      adminUserId: String(admin.id),
    });
    await order.save();

    const customer = this.customerFromOrder(order);
    await this.notifyRefundUpdate({
      customer,
      orderId,
      storeName: this.storeNameFromOrder(order),
      storeId: this.storeIdFromOrder(order) ?? undefined,
      kind: 'paused',
      amountCad: order.totalPrice ?? 0,
    });

    return {
      orderId,
      status: OrderRefundRequestEntryStatusEnum.PAUSED,
    };
  }

  async resumeRefund(
    admin: UserModel,
    orderId: string,
  ): Promise<{ orderId: string; status: string }> {
    assertAdmin(admin);
    const order = await this.loadOrderForRefund(orderId, admin);
    const entry = activeRefundEntry(refundLogFromOrderDoc(order));
    if (entry?.status !== OrderRefundRequestEntryStatusEnum.PAUSED) {
      throw new BadRequestException('refund_not_resumable');
    }
    this.patchLatestEntry(order, {
      status: OrderRefundRequestEntryStatusEnum.PENDING,
      resolutionNote: undefined,
    });
    await order.save();

    const customer = this.customerFromOrder(order);
    await this.notifyRefundUpdate({
      customer,
      orderId,
      storeName: this.storeNameFromOrder(order),
      storeId: this.storeIdFromOrder(order) ?? undefined,
      kind: 'resumed',
      amountCad: order.totalPrice ?? 0,
    });

    return {
      orderId,
      status: OrderRefundRequestEntryStatusEnum.PENDING,
    };
  }

  async cancelRefund(
    admin: UserModel,
    orderId: string,
    note?: string,
  ): Promise<{ orderId: string; status: string }> {
    assertAdmin(admin);
    const order = await this.loadOrderForRefund(orderId, admin);
    const entry = activeRefundEntry(refundLogFromOrderDoc(order));
    if (
      entry?.status !== OrderRefundRequestEntryStatusEnum.PENDING &&
      entry?.status !== OrderRefundRequestEntryStatusEnum.PAUSED
    ) {
      throw new BadRequestException('refund_not_cancellable');
    }
    this.patchLatestEntry(order, {
      status: OrderRefundRequestEntryStatusEnum.REJECTED,
      resolvedAt: new Date(),
      resolutionNote:
        note?.trim()?.slice(0, 500) ||
        'Demande de remboursement annulée par l’équipe.',
      adminUserId: String(admin.id),
      processedBy: 'admin',
    });
    await order.save();

    const customer = this.customerFromOrder(order);
    await this.notifyRefundUpdate({
      customer,
      orderId,
      storeName: this.storeNameFromOrder(order),
      storeId: this.storeIdFromOrder(order) ?? undefined,
      kind: 'rejected',
      amountCad: order.totalPrice ?? 0,
      note: note?.trim(),
    });

    return {
      orderId,
      status: OrderRefundRequestEntryStatusEnum.REJECTED,
    };
  }

  async processRefundForOrder(args: {
    orderId: string;
    processedBy: 'cron' | 'admin';
    admin?: UserModel;
  }): Promise<{ orderId: string; status: string; stripeRefundId?: string }> {
    const order = args.admin
      ? await this.loadOrderForRefund(args.orderId, args.admin)
      : await this.orderModel
          .findById(args.orderId)
          .populate('user', 'fullName email')
          .populate('store', 'name')
          .exec();

    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    const entry = activeRefundEntry(refundLogFromOrderDoc(order));
    if (
      !entry ||
      (entry.status !== OrderRefundRequestEntryStatusEnum.PENDING &&
        entry.status !== OrderRefundRequestEntryStatusEnum.APPROVED)
    ) {
      throw new BadRequestException('refund_not_processable');
    }

    if (order.status !== OrderStatusEnum.CANCELLED) {
      throw new BadRequestException('order_not_cancelled');
    }

    const parentId = stripeParentIdFromOrder(order);
    if (!parentId) {
      this.patchLatestEntry(order, {
        resolutionNote:
          'Paiement Stripe introuvable — traitement manuel requis.',
      });
      await order.save();
      throw new BadRequestException('stripe_payment_missing');
    }

    const grossCents = this.refundAmountCents(order);
    if (grossCents < 1) {
      throw new BadRequestException('refund_amount_invalid');
    }

    const split =
      await this.platformFeesService.computeRefundSplit(grossCents);
    if (split.customerRefundCents < 1) {
      throw new BadRequestException('refund_amount_invalid');
    }

    const feeNote =
      split.platformFeeCents > 0
        ? ` (frais plateforme ${(split.platformFeeCents / 100).toFixed(2)} $ CA)`
        : '';

    this.patchLatestEntry(order, {
      status: OrderRefundRequestEntryStatusEnum.APPROVED,
      resolutionNote: `Remboursement Stripe en cours…${feeNote}`,
      processedBy: args.processedBy,
      adminUserId: args.admin ? String(args.admin.id) : entry.adminUserId,
      refundGrossCents: split.grossCents,
      platformRefundFeeCents: split.platformFeeCents,
      customerRefundCents: split.customerRefundCents,
    });
    await order.save();

    const customer = this.customerFromOrder(order);
    const storeName = this.storeNameFromOrder(order);
    const storeId = this.storeIdFromOrder(order) ?? undefined;
    const netCad = split.customerRefundCents / 100;

    await this.notifyRefundUpdate({
      customer,
      orderId: args.orderId,
      storeName,
      storeId,
      kind: 'processing',
      amountCad: netCad,
    });

    try {
      await this.stripeTransfers.reverseTransferForRefund({
        orderId: args.orderId,
        customerRefundCents: split.customerRefundCents,
      });
    } catch (revErr) {
      this.logger.warn(
        `Transfer reversal before refund ${args.orderId}: ${revErr instanceof Error ? revErr.message : String(revErr)}`,
      );
    }

    let stripeRefundId: string;
    try {
      stripeRefundId = await this.stripeRefund.createRefundForOrder({
        stripeParentPaymentId: parentId,
        amountCents: split.customerRefundCents,
        orderId: args.orderId,
        refundGrossCents: split.grossCents,
        platformRefundFeeCents: split.platformFeeCents,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Stripe refund failed ${args.orderId}: ${msg}`);
      this.patchLatestEntry(order, {
        status: OrderRefundRequestEntryStatusEnum.PENDING,
        resolutionNote: `Échec Stripe : ${msg}`.slice(0, 500),
      });
      await order.save();
      throw new BadRequestException('stripe_refund_failed');
    }

    const completedNote =
      split.platformFeeCents > 0
        ? `Remboursement de ${netCad.toFixed(2)} $ CA effectué (frais plateforme ${(split.platformFeeCents / 100).toFixed(2)} $ CA retenus).`
        : 'Remboursement effectué sur votre moyen de paiement.';

    this.patchLatestEntry(order, {
      status: OrderRefundRequestEntryStatusEnum.COMPLETED,
      stripeRefundId,
      resolvedAt: new Date(),
      resolutionNote: completedNote,
      processedBy: args.processedBy,
      adminUserId: args.admin ? String(args.admin.id) : entry.adminUserId,
      refundGrossCents: split.grossCents,
      platformRefundFeeCents: split.platformFeeCents,
      customerRefundCents: split.customerRefundCents,
    });
    await order.save();

    await this.notifyRefundUpdate({
      customer,
      orderId: args.orderId,
      storeName,
      storeId,
      kind: 'completed',
      amountCad: netCad,
      stripeRefundId,
    });

    void this.ordersService
      .notifyPartiesOrderRealtimeByOrderId(args.orderId, order.status)
      .catch((err) =>
        this.logger.warn(
          `WS after refund: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    return {
      orderId: args.orderId,
      status: OrderRefundRequestEntryStatusEnum.COMPLETED,
      stripeRefundId,
    };
  }

  /** Passe cron : traite les demandes `pending` éligibles. */
  async runScheduledProcessingPass(): Promise<{
    scanned: number;
    processed: number;
    failed: number;
  }> {
    const settings = await this.settingsDoc();
    if (settings.processingPaused) {
      return { scanned: 0, processed: 0, failed: 0 };
    }

    const delayMs = AUTO_DELAY_MINUTES * 60 * 1000;
    const cutoff = new Date(Date.now() - delayMs);

    const orders = await this.orderModel
      .find({
        status: OrderStatusEnum.CANCELLED,
        stripeParentPaymentId: { $exists: true, $ne: '' },
        refundRequestLog: {
          $elemMatch: {
            status: OrderRefundRequestEntryStatusEnum.PENDING,
            requestedAt: { $lte: cutoff },
          },
        },
      })
      .select('_id')
      .limit(50)
      .lean()
      .exec();

    let processed = 0;
    let failed = 0;

    for (const row of orders) {
      const oid = String(row._id);
      try {
        await this.processRefundForOrder({
          orderId: oid,
          processedBy: 'cron',
        });
        processed += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(
          `Cron refund skip/fail ${oid}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return { scanned: orders.length, processed, failed };
  }

  private async notifyRefundUpdate(args: {
    customer: { userId: string; fullName: string; email: string };
    orderId: string;
    storeName: string;
    storeId?: string;
    kind: 'processing' | 'completed' | 'rejected' | 'paused' | 'resumed';
    amountCad: number;
    note?: string;
    stripeRefundId?: string;
  }): Promise<void> {
    const titles: Record<typeof args.kind, string> = {
      processing: 'Remboursement en cours',
      completed: 'Remboursement effectué',
      rejected: 'Demande de remboursement refusée',
      paused: 'Remboursement en pause',
      resumed: 'Remboursement repris',
    };
    const bodies: Record<typeof args.kind, string> = {
      processing: `${args.storeName} : votre remboursement est en cours de traitement.`,
      completed: `${args.storeName} : votre remboursement a été effectué (${args.amountCad.toFixed(2)} $ CA).`,
      rejected: `${args.storeName} : votre demande de remboursement a été refusée.`,
      paused: `${args.storeName} : le traitement de votre remboursement est temporairement en pause.`,
      resumed: `${args.storeName} : le traitement de votre remboursement reprend.`,
    };

    const title = titles[args.kind];
    const body = bodies[args.kind];

    try {
      await this.notifications.notifyCustomerRefundStatus({
        userId: args.customer.userId,
        orderId: args.orderId,
        storeName: args.storeName,
        storeId: args.storeId,
        title,
        body,
        refundStatus: args.kind,
        stripeRefundId: args.stripeRefundId,
      });
    } catch (e) {
      this.logger.warn(
        `notifyCustomerRefundStatus: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const email = args.customer.email?.trim();
    if (!email) return;

    const appName = process.env.APP_NAME?.trim() || 'Afrika Meals';
    const html = `
      <p>Bonjour ${args.customer.fullName},</p>
      <p>${body}</p>
      <p>Commande : <strong>#AE-${args.orderId.slice(-6).toUpperCase()}</strong></p>
      ${args.note ? `<p><em>${args.note}</em></p>` : ''}
      <p>— ${appName}</p>
    `;
    try {
      await this.mailer.sendSimple({
        to: email,
        toName: args.customer.fullName,
        subject: `${appName} — ${title}`,
        html,
        text: body,
      });
    } catch (e) {
      this.logger.warn(
        `refund email: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
