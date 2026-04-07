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

  async sendChatMessagePush(args: {
    recipientUserIds: string[];
    title: string;
    body: string;
    conversationId?: string;
  }): Promise<{ sent: number; failures: number }> {
    const oids = args.recipientUserIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (oids.length === 0) {
      return { sent: 0, failures: 0 };
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

    if (tokenRows.length === 0) {
      return { sent: 0, failures: 0 };
    }

    const messaging = getMessaging(this.firebaseApp);
    const data: Record<string, string> = {
      type: 'chat',
    };
    if (args.conversationId) {
      data.conversationId = args.conversationId;
    }

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

    return { sent, failures };
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
