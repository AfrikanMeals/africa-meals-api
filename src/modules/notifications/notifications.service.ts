import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import {
  AppNotificationModel,
  AppNotificationScopeEnum,
} from '@schemas/app-notification.schema';
import { NotificationReadReceiptModel } from '@schemas/notification-read-receipt.schema';
import { UserModel } from '@schemas/user.schema';
import { FilterQuery, Model, Types } from 'mongoose';

const MAX_TOKENS_PER_USER = 20;

export interface InboxNotificationRow {
  id: string;
  scope: AppNotificationScopeEnum;
  title: string;
  body: string;
  type?: string;
  data?: Record<string, unknown>;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Optional() @Inject('FIREBASE_ADMIN') private readonly firebaseApp: App | null,
    @InjectModel(UserModel.name) private readonly userModel: Model<UserModel>,
    @InjectModel(AppNotificationModel.name)
    private readonly appNotificationModel: Model<AppNotificationModel>,
    @InjectModel(NotificationReadReceiptModel.name)
    private readonly readReceiptModel: Model<NotificationReadReceiptModel>,
  ) {}

  onModuleInit(): void {
    const projectId = this.firebaseApp?.options?.projectId;
    if (!projectId) {
      this.logger.warn(
        'FCM désactivé : Firebase Admin absent. ' +
          'Ajoutez accounts.json (k8s) ou AM_FIREBASE_SERVICE_ACCOUNT_JSON.',
      );
      return;
    }
    this.logger.log(`FCM prêt (projet Firebase Admin : ${projectId})`);
  }

  /**
   * Les jetons sont stockés en base sous `fcm_tokens` (pipeline d’upsert) ;
   * certains documents ont aussi `fcmTokens` (vide ou legacy). On fusionne et déduplique.
   */
  private mergeFcmTokenRows(...arrays: unknown[]): { token: string }[] {
    const seen = new Set<string>();
    const out: { token: string }[] = [];
    const pushToken = (raw: string) => {
      const token = raw.trim();
      if (!token || seen.has(token)) return;
      seen.add(token);
      out.push({ token });
    };
    for (const arr of arrays) {
      if (!Array.isArray(arr)) continue;
      for (const row of arr) {
        if (typeof row === 'string') {
          pushToken(row);
          continue;
        }
        if (!row || typeof row !== 'object') continue;
        pushToken(String((row as { token?: unknown }).token ?? ''));
      }
    }
    return out;
  }

  private inboxFilterForUser(
    userId: string,
  ): FilterQuery<AppNotificationModel> {
    const userOid = new Types.ObjectId(userId);
    return {
      $or: [
        { scope: AppNotificationScopeEnum.GLOBAL },
        {
          scope: AppNotificationScopeEnum.USER,
          recipientUserId: userOid,
        },
      ],
    };
  }

  async listInboxForUser(args: {
    userId: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: InboxNotificationRow[];
    nextCursor: string | null;
    unreadCount: number;
  }> {
    const { userId, limit } = args;
    const base = this.inboxFilterForUser(userId);
    const filter: FilterQuery<AppNotificationModel> =
      args.cursor && Types.ObjectId.isValid(args.cursor)
        ? {
            $and: [base, { _id: { $lt: new Types.ObjectId(args.cursor) } }],
          }
        : base;

    const docs = await this.appNotificationModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const ids = page.map((d) => d._id as Types.ObjectId);
    const userOid = new Types.ObjectId(userId);

    const receipts =
      ids.length === 0
        ? []
        : await this.readReceiptModel
            .find({
              userId: userOid,
              notificationId: { $in: ids },
            })
            .lean()
            .exec();

    const readMap = new Map(
      receipts.map((r) => [String(r.notificationId), r.readAt]),
    );

    const items: InboxNotificationRow[] = page.map((d) => {
      const id = (d._id as Types.ObjectId).toString();
      const readAt = readMap.get(id) ?? null;
      return {
        id,
        scope: d.scope as AppNotificationScopeEnum,
        title: d.title,
        body: d.body,
        type: d.type,
        data: d.data as Record<string, unknown> | undefined,
        read: readAt != null,
        readAt: readAt ? new Date(readAt).toISOString() : null,
        createdAt: new Date(
          (d as { createdAt?: Date }).createdAt ?? Date.now(),
        ).toISOString(),
      };
    });

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? (last._id as Types.ObjectId).toString() : null;

    const unreadCount = await this.countUnreadForUser(userId);

    return { items, nextCursor, unreadCount };
  }

  async countUnreadForUser(userId: string): Promise<number> {
    const userOid = new Types.ObjectId(userId);
    const matchNotif = this.inboxFilterForUser(userId);

    const agg = await this.appNotificationModel
      .aggregate<{ n: number }>([
        { $match: matchNotif },
        {
          $lookup: {
            from: this.readReceiptModel.collection.name,
            let: { nid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$notificationId', '$$nid'] },
                      { $eq: ['$userId', userOid] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'receipt',
          },
        },
        { $match: { receipt: { $size: 0 } } },
        { $count: 'n' },
      ])
      .exec();

    return agg[0]?.n ?? 0;
  }

  async markNotificationsRead(
    userId: string,
    notificationIds: string[],
  ): Promise<{ marked: number }> {
    const userOid = new Types.ObjectId(userId);
    const valid = notificationIds.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) {
      return { marked: 0 };
    }

    const oids = valid.map((id) => new Types.ObjectId(id));
    const visible = await this.appNotificationModel
      .find({
        _id: { $in: oids },
        ...this.inboxFilterForUser(userId),
      })
      .select('_id')
      .lean()
      .exec();

    const now = new Date();
    const ops = visible.map((d) => ({
      updateOne: {
        filter: {
          userId: userOid,
          notificationId: d._id as Types.ObjectId,
        },
        update: { $setOnInsert: { readAt: now } },
        upsert: true,
      },
    }));

    if (ops.length === 0) {
      return { marked: 0 };
    }

    const res = await this.readReceiptModel.bulkWrite(ops, { ordered: false });
    return { marked: res.upsertedCount ?? 0 };
  }

  async markAllNotificationsRead(userId: string): Promise<{ marked: number }> {
    const userOid = new Types.ObjectId(userId);
    const match = this.inboxFilterForUser(userId);
    const cursor = this.appNotificationModel
      .find(match)
      .select('_id')
      .batchSize(500)
      .cursor();

    let marked = 0;
    const batch: {
      updateOne: {
        filter: Record<string, unknown>;
        update: { $setOnInsert: { readAt: Date } };
        upsert: boolean;
      };
    }[] = [];
    const now = new Date();

    for await (const doc of cursor) {
      batch.push({
        updateOne: {
          filter: {
            userId: userOid,
            notificationId: doc._id as Types.ObjectId,
          },
          update: { $setOnInsert: { readAt: now } },
          upsert: true,
        },
      });
      if (batch.length >= 500) {
        const res = await this.readReceiptModel.bulkWrite(batch, {
          ordered: false,
        });
        marked += res.upsertedCount ?? 0;
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      const res = await this.readReceiptModel.bulkWrite(batch, {
        ordered: false,
      });
      marked += res.upsertedCount ?? 0;
    }

    return { marked };
  }

  async createGlobalNotification(args: {
    title: string;
    body: string;
    type?: string;
    data?: Record<string, unknown>;
    sendPush?: boolean;
  }): Promise<{ id: string }> {
    const doc = await this.appNotificationModel.create({
      scope: AppNotificationScopeEnum.GLOBAL,
      title: args.title,
      body: args.body,
      type: args.type,
      data: args.data,
    });

    if (args.sendPush) {
      await this.pushGlobalToAllFcmUsers({
        title: args.title,
        body: args.body,
        data: this.stringifyDataPayload(args.data, {
          type: args.type ?? 'in_app',
        }),
      });
    }

    return { id: doc._id.toString() };
  }

  /**
   * Notification in-app ciblée + push optionnel (appels internes, automatisations).
   */
  async createUserScopedNotification(args: {
    recipientUserId: string;
    title: string;
    body: string;
    type?: string;
    data?: Record<string, unknown>;
    sendPush?: boolean;
    /** Canal Android (ex. `african_meals_courier_orders`). */
    androidChannelId?: string;
  }): Promise<{ id: string }> {
    if (!Types.ObjectId.isValid(args.recipientUserId)) {
      throw new NotFoundException('user_not_found');
    }
    const recipient = await this.userModel
      .findById(args.recipientUserId)
      .select('_id')
      .lean()
      .exec();
    if (!recipient) {
      throw new NotFoundException('user_not_found');
    }

    const doc = await this.appNotificationModel.create({
      scope: AppNotificationScopeEnum.USER,
      recipientUserId: new Types.ObjectId(args.recipientUserId),
      title: args.title,
      body: args.body,
      type: args.type,
      data: args.data,
    });

    if (args.sendPush) {
      await this.sendMulticastNotification({
        recipientUserIds: [args.recipientUserId],
        title: args.title,
        body: args.body,
        data: this.stringifyDataPayload(args.data, {
          type: args.type ?? 'in_app',
          notificationId: doc._id.toString(),
        }),
        androidChannelId: args.androidChannelId,
      });
    }

    return { id: doc._id.toString() };
  }

  private stringifyDataPayload(
    data: Record<string, unknown> | undefined,
    extra: Record<string, string>,
  ): Record<string, string> {
    const out: Record<string, string> = { ...extra };
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        if (v === undefined || v === null) continue;
        out[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
    }
    return out;
  }

  private async pushGlobalToAllFcmUsers(args: {
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<void> {
    const cur = this.userModel.collection
      .find({
        $or: [
          { 'fcm_tokens.0': { $exists: true } },
          { 'fcmTokens.0': { $exists: true } },
        ],
      })
      .project({ _id: 1 })
      .batchSize(500);

    const chunk: string[] = [];
    for await (const u of cur) {
      const id = u._id;
      chunk.push(id instanceof Types.ObjectId ? id.toString() : String(id));
      if (chunk.length >= 500) {
        await this.sendMulticastNotification({
          recipientUserIds: [...chunk],
          title: args.title,
          body: args.body,
          data: args.data,
        });
        chunk.length = 0;
      }
    }
    if (chunk.length > 0) {
      await this.sendMulticastNotification({
        recipientUserIds: chunk,
        title: args.title,
        body: args.body,
        data: args.data,
      });
    }
  }

  /**
   * Envoie une notification + payload `data` à tous les jetons FCM des utilisateurs ciblés.
   */
  async sendMulticastNotification(args: {
    recipientUserIds: string[];
    title: string;
    body: string;
    data: Record<string, string>;
    /** Canal Android (Flutter : même id que [FlutterLocalNotifications] côté app). */
    androidChannelId?: string;
    /** FCM data-only (sans bannière système) — utile pour déclencher l’UI in-app au premier plan. */
    dataOnly?: boolean;
  }): Promise<{ sent: number; failures: number; deviceCount: number }> {
    if (!this.firebaseApp) {
      return { sent: 0, failures: 0, deviceCount: 0 };
    }

    const oids = args.recipientUserIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (oids.length === 0) {
      return { sent: 0, failures: 0, deviceCount: 0 };
    }

    const mongoUsers = await this.userModel.collection
      .find({ _id: { $in: oids } })
      .project({ _id: 1, fcm_tokens: 1, fcmTokens: 1 })
      .toArray();

    const tokenRows: { userId: string; token: string }[] = [];
    for (const u of mongoUsers) {
      const raw = u as Record<string, unknown>;
      const id = raw._id;
      const uid =
        id instanceof Types.ObjectId
          ? id.toHexString()
          : Types.ObjectId.isValid(String(id))
          ? new Types.ObjectId(String(id)).toHexString()
          : String(id);
      const merged = this.mergeFcmTokenRows(raw.fcm_tokens, raw.fcmTokens);
      for (const row of merged) {
        tokenRows.push({ userId: uid, token: row.token });
      }
    }

    const deviceCount = tokenRows.length;
    if (deviceCount === 0) {
      return { sent: 0, failures: 0, deviceCount: 0 };
    }

    const messaging = getMessaging(this.firebaseApp);
    const data = { ...args.data };

    const androidChannelId = args.androidChannelId?.trim();
    const androidCfg = androidChannelId
      ? {
          priority: 'high' as const,
          notification: {
            channelId: androidChannelId,
            sound: 'default' as const,
          },
        }
      : { priority: 'high' as const };

    const messages = tokenRows.map((row) => {
      const base = {
        token: row.token,
        data,
        android: androidCfg,
        apns: {
          payload: {
            aps: args.dataOnly
              ? { contentAvailable: true }
              : {
                  sound: 'default',
                  contentAvailable: true,
                },
          },
        },
      };
      if (args.dataOnly) {
        return base;
      }
      return {
        ...base,
        notification: {
          title: args.title,
          body: args.body,
        },
      };
    });

    let sent = 0;
    let failures = 0;
    const invalidTokens = new Set<string>();

    const chunkSize = 400;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const slice = messages.slice(i, i + chunkSize);
      const response = await messaging.sendEach(slice);
      response.responses.forEach((resp, idx) => {
        const globalIdx = i + idx;
        const tok = tokenRows[globalIdx]?.token;
        if (resp.success) {
          sent++;
        } else {
          failures++;
          const code = resp.error?.code ?? '';
          if (
            code.includes('invalid-registration-token') ||
            code.includes('registration-token-not-registered') ||
            code.includes('mismatched-credential') ||
            code.includes('invalid-argument')
          ) {
            if (tok) invalidTokens.add(tok);
          } else {
            const hint =
              code === 'messaging/third-party-auth-error'
                ? ' — vérifiez AM_FIREBASE_SERVICE_ACCOUNT_* (compte de service), pas la clé VAPID ; pour iOS, configurez APNs dans la console Firebase'
                : '';
            this.logger.warn(
              `FCM error: ${code} ${resp.error?.message ?? ''}${hint}`,
            );
          }
        }
      });
    }

    if (invalidTokens.size > 0) {
      const arr = [...invalidTokens];
      await this.userModel.collection.updateMany({}, {
        $pull: {
          fcm_tokens: { token: { $in: arr } },
          fcmTokens: { token: { $in: arr } },
        },
      } as Record<string, unknown>);
    }

    return { sent, failures, deviceCount };
  }

  private static orderStatusLabelFr(status: string): string {
    const s = status.trim().toLowerCase();
    switch (s) {
      case 'created':
        return 'En attente de paiement';
      case 'paied':
      case 'paid':
        return 'Payée';
      case 'approved':
        return 'Approuvée';
      case 'cancelled':
        return 'Annulée';
      case 'shipped':
        return 'En livraison';
      case 'completed':
        return 'Terminée';
      default:
        return status || 'Mise à jour';
    }
  }

  private static shortOrderPublicRef(orderId: string): string {
    const t = (orderId ?? '').trim();
    if (t.length >= 6) return t.slice(-6).toUpperCase();
    return t.toUpperCase();
  }

  /**
   * Centre de messages in-app (aligné sur le chat) — sans second push FCM.
   */
  private async persistCustomerOrderInbox(args: {
    userId: string;
    orderId: string;
    storeName?: string;
    storeId?: string;
    body: string;
    reason: 'created' | 'status_changed' | 'vendor_accepted';
    status: string;
  }): Promise<void> {
    try {
      const store = (args.storeName ?? '').trim() || 'Restaurant';
      const ref = NotificationsService.shortOrderPublicRef(args.orderId);
      const title = `${store} • #${ref}`;
      const data: Record<string, unknown> = {
        type: 'order',
        orderId: args.orderId,
        storeName: store,
        reason: args.reason,
        status: args.status,
      };
      const sid = args.storeId?.trim();
      if (sid) {
        data.storeId = sid;
      }
      await this.createUserScopedNotification({
        recipientUserId: args.userId,
        title,
        body:
          (args.body ?? '').trim() ||
          NotificationsService.orderStatusLabelFr(args.status),
        type: 'order',
        data,
        sendPush: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`persistCustomerOrderInbox: ${msg}`);
    }
  }

  /**
   * Push FCM — nouvelle commande (ex. panier → `created`, payer plus tard).
   */
  async pushCustomerOrderCreated(args: {
    userId: string;
    orderId: string;
    storeName?: string;
    storeId?: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.userId)) {
      return;
    }
    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const statusLabel = NotificationsService.orderStatusLabelFr('created');
    // Inbox d’abord : évite qu’un flux « créer puis payer tout de suite »
    // (ex. webhook Stripe) enregistre « Payée » avant « En attente de paiement »
    // quand le FCM « créé » est encore en cours.
    await this.persistCustomerOrderInbox({
      userId: args.userId,
      orderId: args.orderId,
      storeName: args.storeName,
      storeId: args.storeId,
      body: statusLabel,
      reason: 'created',
      status: 'created',
    });

    void this.sendMulticastNotification({
      recipientUserIds: [args.userId],
      title: 'Commande enregistrée',
      body: `${store} : votre commande est en attente. Payez quand vous voulez.`,
      data: {
        type: 'order_update',
        audience: 'customer',
        reason: 'created',
        orderId: args.orderId,
        storeName: store,
        status: 'created',
      },
    })
      .then((res) => {
        if (res.deviceCount === 0) {
          this.logger.warn(
            `pushCustomerOrderCreated: aucun jeton FCM pour l’utilisateur ${args.userId}`,
          );
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`pushCustomerOrderCreated: ${msg}`);
      });
  }

  /**
   * Push FCM — changement de statut de commande côté client.
   */
  async pushCustomerOrderStatusChanged(args: {
    userId: string;
    orderId: string;
    storeName?: string;
    storeId?: string;
    previousStatus: string;
    newStatus: string;
    /** Libellé court dans le corps du push (ex. prêt retrait / livraison). */
    bodyOverride?: string;
    /** Raison métier (`vendor_accepted` autorise une notif même si le statut API est inchangé). */
    reason?: string;
    titleOverride?: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.userId)) {
      return;
    }
    const prev = (args.previousStatus ?? '').trim().toLowerCase();
    const next = (args.newStatus ?? '').trim().toLowerCase();
    const reason = (args.reason ?? 'status_changed').trim().toLowerCase();
    const forceNotify =
      reason === 'vendor_accepted' || Boolean(args.bodyOverride?.trim());
    if (!next || (prev === next && !forceNotify)) {
      return;
    }
    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const label =
      (args.bodyOverride ?? '').trim() ||
      NotificationsService.orderStatusLabelFr(next);
    const title =
      (args.titleOverride ?? '').trim() || 'Commande mise à jour';
    const inboxReason: 'created' | 'status_changed' | 'vendor_accepted' =
      reason === 'vendor_accepted' ? 'vendor_accepted' : 'status_changed';
    await this.persistCustomerOrderInbox({
      userId: args.userId,
      orderId: args.orderId,
      storeName: args.storeName,
      storeId: args.storeId,
      body: label,
      reason: inboxReason,
      status: next,
    });

    void this.sendMulticastNotification({
      recipientUserIds: [args.userId],
      title,
      body: `${store} : ${label}`,
      data: {
        type: 'order_update',
        audience: 'customer',
        reason,
        orderId: args.orderId,
        storeName: store,
        status: next,
        previousStatus: prev || 'unknown',
      },
    })
      .then((res) => {
        if (res.deviceCount === 0) {
          this.logger.warn(
            `pushCustomerOrderStatusChanged: aucun jeton FCM pour l’utilisateur ${args.userId}`,
          );
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`pushCustomerOrderStatusChanged: ${msg}`);
      });
  }

  /** Inbox + push FCM — mise à jour remboursement commande. */
  async notifyCustomerRefundStatus(args: {
    userId: string;
    orderId: string;
    storeName?: string;
    storeId?: string;
    title: string;
    body: string;
    refundStatus: string;
    stripeRefundId?: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.userId)) {
      return;
    }
    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const data = {
      type: 'refund_update',
      audience: 'customer',
      orderId: args.orderId,
      storeName: store,
      storeId: args.storeId ?? '',
      refundStatus: args.refundStatus,
      stripeRefundId: args.stripeRefundId ?? '',
    };

    try {
      await this.createUserScopedNotification({
        recipientUserId: args.userId,
        title: args.title,
        body: args.body,
        type: 'refund',
        data,
        sendPush: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`notifyCustomerRefundStatus: ${msg}`);
    }
  }

  /**
   * Inbox + push FCM — menu du jour non défini pour aujourd’hui (vendeur).
   */
  /**
   * Inbox + push FCM — fin d’essai abonnement vendeur (jours restants).
   */
  async notifyVendorSubscriptionTrialEnding(args: {
    recipientUserId: string;
    subscriptionId: string;
    storeId: string;
    planName?: string;
    daysRemaining: number;
    trialEndsAt: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.recipientUserId)) {
      return;
    }
    const plan = (args.planName ?? '').trim() || 'votre formule';
    const days = Math.max(1, Math.floor(args.daysRemaining));
    const title =
      days <= 1 ? 'Essai abonnement : dernier jour' : 'Rappel essai abonnement';
    const body =
      days <= 1
        ? `Votre essai ${plan} se termine demain. Souscrivez pour garder le mode vendeur.`
        : `Il reste ${days} jour(s) à votre essai ${plan}. Souscrivez avant la fin.`;
    const data: Record<string, unknown> = {
      type: 'subscription_trial_reminder',
      audience: 'vendor',
      subscriptionId: args.subscriptionId,
      storeId: args.storeId,
      planName: plan,
      daysRemaining: String(days),
      trialEndsAt: args.trialEndsAt,
    };

    try {
      await this.createUserScopedNotification({
        recipientUserId: args.recipientUserId,
        title,
        body,
        type: 'subscription_trial_reminder',
        data,
        sendPush: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`notifyVendorSubscriptionTrialEnding: ${msg}`);
    }
  }

  /**
   * Inbox + push FCM — candidature livreur approuvée ou refusée.
   */
  async notifyDeliveryAgentApplicationReview(args: {
    recipientUserId: string;
    applicationId: string;
    status: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
    rejectionReason?: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.recipientUserId)) {
      return;
    }
    const approved = args.status === 'APPROVED';
    const suspended = args.status === 'SUSPENDED';
    const title = approved
      ? 'Candidature livreur acceptée'
      : suspended
      ? 'Compte livreur suspendu'
      : 'Candidature livreur refusée';
    const body = approved
      ? 'Félicitations ! Vous pouvez maintenant utiliser le mode livreur dans l’application.'
      : suspended
      ? `Votre compte livreur a été suspendu.${
          args.rejectionReason?.trim()
            ? ` Motif : ${args.rejectionReason.trim()}`
            : ''
        }`
      : `Votre candidature n’a pas été retenue.${
          args.rejectionReason?.trim()
            ? ` Motif : ${args.rejectionReason.trim()}`
            : ''
        }`;
    const data: Record<string, unknown> = {
      type: 'delivery_agent_application',
      audience: 'customer',
      applicationId: args.applicationId,
      status: args.status,
    };
    if (!approved && args.rejectionReason?.trim()) {
      data.rejectionReason = args.rejectionReason.trim();
    }

    try {
      await this.createUserScopedNotification({
        recipientUserId: args.recipientUserId,
        title,
        body,
        type: 'delivery_agent_application',
        data,
        sendPush: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`notifyDeliveryAgentApplicationReview: ${msg}`);
    }
  }

  /**
   * Inbox + push FCM — course assignée ou retirée (livreur app).
   */
  async notifyDeliveryAgentOrderAssignment(args: {
    recipientUserId: string;
    orderId: string;
    orderRef?: string;
    storeName?: string;
    storeId?: string;
    action: 'assigned' | 'unassigned';
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.recipientUserId)) {
      return;
    }
    const orderId = args.orderId?.trim();
    if (!orderId) return;

    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const ref =
      (args.orderRef ?? '').trim() ||
      `#AE-${orderId.slice(-6).toUpperCase()}`;
    const assigned = args.action === 'assigned';
    const title = assigned ? 'Nouvelle course' : 'Course retirée';
    const body = assigned
      ? `${store} : la course ${ref} vous a été assignée. Ouvrez la carte pour démarrer.`
      : `${store} : la course ${ref} ne vous est plus assignée.`;

    const data: Record<string, unknown> = {
      type: 'courier_order_update',
      audience: 'courier',
      reason: assigned ? 'order_assigned' : 'order_unassigned',
      orderId,
      orderRef: ref,
      storeName: store,
      action: args.action,
    };
    const storeId = args.storeId?.trim();
    if (storeId) {
      data.storeId = storeId;
    }

    try {
      await this.createUserScopedNotification({
        recipientUserId: args.recipientUserId,
        title,
        body,
        type: 'courier_order_update',
        data,
        sendPush: true,
        androidChannelId: 'african_meals_courier_orders',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`notifyDeliveryAgentOrderAssignment: ${msg}`);
    }
  }

  /**
   * Inbox + push — course marketplace disponible dans le rayon du livreur.
   */
  async notifyCourierMarketplaceAvailable(args: {
    recipientUserId: string;
    orderId: string;
    orderRef?: string;
    storeName?: string;
    storeId?: string;
    distanceMeters?: number | null;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.recipientUserId)) {
      return;
    }
    const orderId = args.orderId?.trim();
    if (!orderId) return;

    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const ref =
      (args.orderRef ?? '').trim() ||
      `#AE-${orderId.slice(-6).toUpperCase()}`;
    const distKm =
      args.distanceMeters != null && Number.isFinite(args.distanceMeters)
        ? Math.round((args.distanceMeters / 1000) * 10) / 10
        : null;
    const distSuffix = distKm != null ? ` (~${distKm} km)` : '';
    const title = 'Nouvelle course disponible';
    const body = `${store} : ${ref} est à prendre près de vous${distSuffix}.`;

    const data: Record<string, unknown> = {
      type: 'courier_marketplace_available',
      audience: 'courier',
      reason: 'marketplace_available',
      orderId,
      orderRef: ref,
      storeName: store,
      claimable: 'true',
    };
    if (distKm != null) {
      data.distanceKm = String(distKm);
    }
    const storeId = args.storeId?.trim();
    if (storeId) {
      data.storeId = storeId;
    }

    try {
      await this.createUserScopedNotification({
        recipientUserId: args.recipientUserId,
        title,
        body,
        type: 'courier_marketplace_available',
        data,
        sendPush: true,
        androidChannelId: 'african_meals_courier_orders',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`notifyCourierMarketplaceAvailable: ${msg}`);
    }
  }

  /**
   * Push — un autre livreur a pris la course (soft guard : claim encore tentable).
   */
  async notifyCourierOrderClaimedByOther(args: {
    recipientUserId: string;
    orderId: string;
    orderRef?: string;
    storeName?: string;
    claimedByUserId?: string;
    softGuardSec?: number;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.recipientUserId)) {
      return;
    }
    const orderId = args.orderId?.trim();
    if (!orderId) return;

    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const ref =
      (args.orderRef ?? '').trim() ||
      `#AE-${orderId.slice(-6).toUpperCase()}`;
    const title = 'Course prise';
    const body = `${store} : ${ref} a été acceptée par un autre livreur. Vous pouvez encore tenter si besoin.`;

    const data: Record<string, unknown> = {
      type: 'courier_order_claimed_by_other',
      audience: 'courier',
      reason: 'order_claimed_by_other',
      orderId,
      orderRef: ref,
      storeName: store,
      claimable: 'soft_guard',
      softGuardSec: String(args.softGuardSec ?? 45),
    };
    if (args.claimedByUserId) {
      data.claimedByUserId = args.claimedByUserId;
    }

    try {
      await this.createUserScopedNotification({
        recipientUserId: args.recipientUserId,
        title,
        body,
        type: 'courier_order_claimed_by_other',
        data,
        sendPush: true,
        androidChannelId: 'african_meals_courier_orders',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`notifyCourierOrderClaimedByOther: ${msg}`);
    }
  }

  async notifyCourierDeliveryOffer(args: {
    recipientUserId: string;
    orderId: string;
    offerId: string;
    orderRef?: string;
    storeName?: string;
    storeId?: string;
    expiresAt: string;
    timeoutSec: number;
  }): Promise<void> {
    // Inbox + push FCM — offre course exclusive flotte boutique.
    if (!Types.ObjectId.isValid(args.recipientUserId)) {
      return;
    }
    const orderId = args.orderId?.trim();
    const offerId = args.offerId?.trim();
    if (!orderId || !offerId) return;

    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const ref =
      (args.orderRef ?? '').trim() ||
      `#AE-${orderId.slice(-6).toUpperCase()}`;
    const title = 'Course proposée';
    const body = `${store} : acceptez la course ${ref} (${args.timeoutSec}s).`;

    const data: Record<string, unknown> = {
      type: 'courier_delivery_offer',
      audience: 'courier',
      reason: 'delivery_offer',
      orderId,
      offerId,
      orderRef: ref,
      storeName: store,
      expiresAt: args.expiresAt,
      timeoutSec: String(args.timeoutSec),
    };
    const storeId = args.storeId?.trim();
    if (storeId) {
      data.storeId = storeId;
    }

    try {
      await this.createUserScopedNotification({
        recipientUserId: args.recipientUserId,
        title,
        body,
        type: 'courier_delivery_offer',
        data,
        sendPush: true,
        androidChannelId: 'african_meals_courier_orders',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`notifyCourierDeliveryOffer: ${msg}`);
    }
  }

  async notifyVendorDailyMenuMissing(args: {
    recipientUserId: string;
    storeId: string;
    storeName?: string;
    dayOfWeek: number;
    reminderDate: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.recipientUserId)) {
      return;
    }
    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const title = 'Menu du jour';
    const body =
      `Vous n'avez pas encore défini le menu du jour pour aujourd'hui. ` +
      `Ajoutez vos plats dans l'onglet Catalogue.`;
    const data: Record<string, unknown> = {
      type: 'daily_menu_reminder',
      audience: 'vendor',
      storeId: args.storeId,
      storeName: store,
      dayOfWeek: String(args.dayOfWeek),
      reminderDate: args.reminderDate,
    };

    try {
      await this.createUserScopedNotification({
        recipientUserId: args.recipientUserId,
        title,
        body,
        type: 'daily_menu_reminder',
        data,
        sendPush: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`notifyVendorDailyMenuMissing: ${msg}`);
    }
  }

  /**
   * Push FCM — restaurateur / espace admin (nouvelle commande, paiement, expédition).
   */
  async pushVendorOrderNotify(args: {
    vendorUserIds: string[];
    title: string;
    body: string;
    orderId: string;
    storeId?: string;
    storeName?: string;
    reason: string;
    status?: string;
  }): Promise<void> {
    const ids = [...new Set(args.vendorUserIds)].filter((id) =>
      Types.ObjectId.isValid(id),
    );
    if (ids.length === 0) {
      return;
    }
    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const status = (args.status ?? '').trim().toLowerCase();
    try {
      const res = await this.sendMulticastNotification({
        recipientUserIds: ids,
        title: args.title,
        body: args.body,
        data: {
          type: 'order_update',
          audience: 'vendor',
          reason: args.reason,
          orderId: args.orderId,
          storeId: args.storeId,
          storeName: store,
          status: status || 'unknown',
          url: '/commandes',
        },
        androidChannelId: 'african_meals_vendor_orders',
      });
      if (res.deviceCount === 0) {
        this.logger.warn(
          `pushVendorOrderNotify: aucun jeton FCM pour les IDs ${ids.join(
            ', ',
          )}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`pushVendorOrderNotify: ${msg}`);
    }
  }

  /**
   * Une entrée par destinataire dans `app_notifications` (in-app + compteur non lu).
   * Les accusés de lecture restent sur `notification_read_receipts`.
   */
  private async persistChatInboxNotifications(args: {
    recipientUserIds: string[];
    title: string;
    body: string;
    conversationId?: string;
    storeId?: string;
    storeName?: string;
  }): Promise<void> {
    const valid = [...new Set(args.recipientUserIds)].filter((id) =>
      Types.ObjectId.isValid(id),
    );
    if (valid.length === 0) {
      return;
    }

    const data: Record<string, unknown> = {
      type: 'chat',
    };
    const cid = args.conversationId?.trim();
    if (cid) {
      data.conversationId = cid;
    }
    const sid = args.storeId?.trim();
    if (sid) {
      data.storeId = sid;
    }
    const sname = args.storeName?.trim();
    if (sname) {
      data.storeName = sname;
    }

    const displayTitle = sname || args.title?.trim() || 'Wise Eat';

    await this.appNotificationModel.insertMany(
      valid.map((uid) => ({
        scope: AppNotificationScopeEnum.USER,
        recipientUserId: new Types.ObjectId(uid),
        title: displayTitle,
        body: (args.body ?? '').trim(),
        type: 'chat',
        data,
      })),
      { ordered: false },
    );
  }

  async sendChatMessagePush(args: {
    recipientUserIds: string[];
    title: string;
    body: string;
    conversationId?: string;
    storeId?: string;
    storeName?: string;
  }): Promise<{ sent: number; failures: number }> {
    try {
      await this.persistChatInboxNotifications(args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`persistChatInboxNotifications failed: ${msg}`);
    }

    const data: Record<string, string> = {
      type: 'chat',
    };
    if (args.conversationId) {
      data.conversationId = args.conversationId;
    }
    if (args.storeId?.trim()) {
      data.storeId = args.storeId.trim();
    }
    if (args.storeName?.trim()) {
      data.storeName = args.storeName.trim();
    }
    const displayTitle =
      args.storeName?.trim() || args.title?.trim() || 'Wise Eat';
    const r = await this.sendMulticastNotification({
      recipientUserIds: args.recipientUserIds,
      title: displayTitle,
      body: args.body,
      data,
      androidChannelId: 'african_meals_chat',
    });
    return { sent: r.sent, failures: r.failures };
  }

  /**
   * Notification de test (Swagger / diagnostic) — `data.type` = `fcm_test`.
   */
  async sendFcmTestPush(args: {
    recipientUserId: string;
    title: string;
    body: string;
  }): Promise<{ sent: number; failures: number; deviceCount: number }> {
    return this.sendMulticastNotification({
      recipientUserIds: [args.recipientUserId],
      title: args.title,
      body: args.body,
      data: {
        type: 'fcm_test',
        source: 'api',
      },
    });
  }

  async registerUserFcmToken(
    userId: string,
    token: string,
    platform: string,
  ): Promise<void> {
    const t = token.trim();
    if (!t) {
      return;
    }
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    const p = (platform || 'unknown').toLowerCase();
    const now = new Date();
    // Mise à jour atomique (évite VersionError si d’autres requêtes modifient l’utilisateur en parallèle).
    // Champ MongoDB = `fcm_tokens` (@Prop name), pas `fcmTokens`.
    await this.userModel.updateOne({ _id: new Types.ObjectId(userId) }, [
      {
        $set: {
          fcm_tokens: {
            $slice: [
              {
                $concatArrays: [
                  [{ token: t, platform: p, updatedAt: now }],
                  {
                    $filter: {
                      input: { $ifNull: ['$fcm_tokens', []] },
                      as: 'x',
                      cond: { $ne: ['$$x.token', t] },
                    },
                  },
                ],
              },
              MAX_TOKENS_PER_USER,
            ],
          },
        },
      },
    ]);
  }

  async removeUserFcmToken(userId: string, token: string): Promise<void> {
    const t = token.trim();
    if (!t) return;
    await this.userModel.collection.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $pull: {
          fcm_tokens: { token: t },
          fcmTokens: { token: t },
        },
      } as Record<string, unknown>,
    );
  }

  /** Inbox + push — livreur a quitté la flotte d'un restaurant partenaire. */
  async notifyStoreDriverLeftPartner(args: {
    courierUserId: string;
    courierName: string;
    storeId: string;
    storeName: string;
    vendorUserId: string;
  }): Promise<void> {
    const store = (args.storeName ?? '').trim() || 'Restaurant';
    const courier = (args.courierName ?? '').trim() || 'Livreur';
    const storeId = args.storeId?.trim() ?? '';
    const baseData = {
      storeId,
      storeName: store,
      courierName: courier,
      membershipAction: 'left',
    };

    const courierTitle = 'Partenariat terminé';
    const courierBody = `Vous avez quitté la flotte de livraison de ${store}.`;
    const vendorTitle = 'Livreur partant';
    const vendorBody = `${courier} a quitté la flotte de livraison de ${store}.`;

    const tasks: Array<Promise<void>> = [];

    if (Types.ObjectId.isValid(args.courierUserId)) {
      tasks.push(
        this.createUserScopedNotification({
          recipientUserId: args.courierUserId,
          title: courierTitle,
          body: courierBody,
          type: 'store_driver_partner_left',
          data: { ...baseData, audience: 'courier' },
          sendPush: true,
          androidChannelId: 'african_meals_courier_orders',
        }).then(() => undefined),
      );
    }

    if (Types.ObjectId.isValid(args.vendorUserId)) {
      tasks.push(
        this.createUserScopedNotification({
          recipientUserId: args.vendorUserId,
          title: vendorTitle,
          body: vendorBody,
          type: 'store_driver_partner_left',
          data: { ...baseData, audience: 'vendor', courierUserId: args.courierUserId },
          sendPush: true,
          androidChannelId: 'african_meals_vendor_orders',
        }).then(() => undefined),
      );
    }

    await Promise.all(
      tasks.map((p) =>
        p.catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn(`notifyStoreDriverLeftPartner: ${msg}`);
        }),
      ),
    );
  }
}
