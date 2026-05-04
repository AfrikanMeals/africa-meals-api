import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject('FIREBASE_ADMIN') private readonly firebaseApp: App,
    @InjectModel(UserModel.name) private readonly userModel: Model<UserModel>,
    @InjectModel(AppNotificationModel.name)
    private readonly appNotificationModel: Model<AppNotificationModel>,
    @InjectModel(NotificationReadReceiptModel.name)
    private readonly readReceiptModel: Model<NotificationReadReceiptModel>,
  ) {}

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
      hasMore && last
        ? (last._id as Types.ObjectId).toString()
        : null;

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
        data: this.stringifyDataPayload(args.data, { type: args.type ?? 'in_app' }),
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
    const cur = this.userModel
      .find({ 'fcmTokens.0': { $exists: true } })
      .select('_id')
      .batchSize(500)
      .cursor();

    const chunk: string[] = [];
    for await (const u of cur) {
      chunk.push((u._id as Types.ObjectId).toString());
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
  }): Promise<{ sent: number; failures: number; deviceCount: number }> {
    const oids = args.recipientUserIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (oids.length === 0) {
      return { sent: 0, failures: 0, deviceCount: 0 };
    }

    const users = await this.userModel
      .find({ _id: { $in: oids } })
      .select({ fcmTokens: 1 })
      .lean()
      .exec();

    const tokenRows: { userId: string; token: string }[] = [];
    for (const u of users) {
      const doc = u as unknown as {
        _id: Types.ObjectId;
        fcmTokens?: { token: string }[];
      };
      const uid = doc._id.toString();
      const tokens = doc.fcmTokens ?? [];
      for (const row of tokens) {
        if (row?.token?.trim()) {
          tokenRows.push({ userId: uid, token: row.token.trim() });
        }
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

    const messages = tokenRows.map((row) => ({
      token: row.token,
      notification: {
        title: args.title,
        body: args.body,
      },
      data,
      android: androidCfg,
      apns: {
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      },
    }));

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
            code.includes('invalid-argument')
          ) {
            if (tok) invalidTokens.add(tok);
          } else {
            this.logger.warn(
              `FCM error: ${code} ${resp.error?.message ?? ''}`,
            );
          }
        }
      });
    }

    if (invalidTokens.size > 0) {
      const arr = [...invalidTokens];
      await this.userModel.updateMany(
        {},
        {
          $pull: {
            fcmTokens: { token: { $in: arr } },
          },
        },
      );
    }

    return { sent, failures, deviceCount };
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

    const displayTitle =
      sname || args.title?.trim() || 'African Meals';

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
      args.storeName?.trim() || args.title?.trim() || 'African Meals';
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
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      [
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
      ],
    );
  }

  async removeUserFcmToken(userId: string, token: string): Promise<void> {
    const t = token.trim();
    if (!t) return;
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $pull: { fcmTokens: { token: t } } },
    );
  }
}
