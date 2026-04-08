import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { Model, Types } from 'mongoose';
import { UserModel } from '@schemas/user.schema';

const MAX_TOKENS_PER_USER = 20;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject('FIREBASE_ADMIN') private readonly firebaseApp: App,
    @InjectModel(UserModel.name) private readonly userModel: Model<UserModel>,
  ) {}

  /**
   * Envoie une notification + payload `data` à tous les jetons FCM des utilisateurs ciblés.
   */
  async sendMulticastNotification(args: {
    recipientUserIds: string[];
    title: string;
    body: string;
    data: Record<string, string>;
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

    const messages = tokenRows.map((row) => ({
      token: row.token,
      notification: {
        title: args.title,
        body: args.body,
      },
      data,
      android: { priority: 'high' as const },
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

  async sendChatMessagePush(args: {
    recipientUserIds: string[];
    title: string;
    body: string;
    conversationId?: string;
    storeId?: string;
    storeName?: string;
  }): Promise<{ sent: number; failures: number }> {
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
    const r = await this.sendMulticastNotification({
      recipientUserIds: args.recipientUserIds,
      title: args.title,
      body: args.body,
      data,
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
    const p = (platform || 'unknown').toLowerCase();
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      return;
    }
    const list = (user.fcmTokens ?? []).filter((x) => x.token !== t);
    list.unshift({
      token: t,
      platform: p,
      updatedAt: new Date(),
    });
    user.fcmTokens = list.slice(0, MAX_TOKENS_PER_USER);
    await user.save();
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
