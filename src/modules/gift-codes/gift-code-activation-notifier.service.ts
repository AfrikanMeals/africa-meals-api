import { MailerService } from '@modules/mailer/mailer.service';
import { MediasService } from '@modules/medias/medias.service';
import {
  resolveEmailImageUrl,
  resolveEmailWebSiteBase,
} from '@modules/mailer/email-web-asset-url.util';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { WsInboxNotifyService } from '@modules/ws-notify/ws-inbox-notify.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  GiftCodeDiscountTypeEnum,
  GiftCodeModel,
} from '@schemas/gift_code.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

const USER_BATCH_SIZE = 100;
const USER_PARALLEL = 10;
const MAX_USERS = 50_000;

type RecipientRow = {
  userId: string;
  email: string;
  fullName: string;
};

export type GiftCodeActivationPayload = {
  giftCodeId: string;
  code: string;
  title: string;
  subtitle: string;
  discountLabel: string;
  imageUrl?: string | null;
};

@Injectable()
export class GiftCodeActivationNotifierService {
  private readonly logger = new Logger(GiftCodeActivationNotifierService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(GiftCodeModel.name)
    private readonly giftCodeModel: Model<GiftCodeModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly notifications: NotificationsService,
    private readonly mailer: MailerService,
    private readonly wsInboxNotify: WsInboxNotifyService,
    private readonly medias: MediasService,
  ) {}

  /** Déclenchement asynchrone après création / activation admin. */
  scheduleActivationNotify(giftCodeId: string): void {
    void this.runActivationNotify(giftCodeId);
  }

  formatDiscountLabel(
    discountType: GiftCodeDiscountTypeEnum,
    value: number,
  ): string {
    if (discountType === GiftCodeDiscountTypeEnum.PERCENTAGE) {
      const pct = Math.round(value * 100) / 100;
      return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}% OFF`;
    }
    const amt = Math.round(value * 100) / 100;
    return `${amt % 1 === 0 ? amt.toFixed(0) : amt.toFixed(2)} OFF`;
  }

  private platformName(): string {
    return this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
  }

  private appScheme(): string {
    return (
      this.config.get<string>('MOBILE_DEEP_LINK_SCHEME')?.trim() || 'wise-eat'
    );
  }

  private giftCodesDeepLink(): string {
    return `${this.appScheme()}://open/gift-codes`;
  }

  private async mapPool<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    if (!items.length) return;
    let index = 0;
    const workers = Math.min(Math.max(1, limit), items.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (;;) {
          const i = index++;
          if (i >= items.length) break;
          await fn(items[i]);
        }
      }),
    );
  }

  private buildPushData(payload: GiftCodeActivationPayload): Record<string, string> {
    return {
      type: 'gift_code_promo',
      audience: 'customer',
      giftCodeId: payload.giftCodeId,
      code: payload.code,
      title: payload.title,
      body: payload.subtitle || payload.discountLabel,
      discountLabel: payload.discountLabel,
      deepLink: this.giftCodesDeepLink(),
    };
  }

  private buildEmailHtml(args: {
    recipientName: string;
    payload: GiftCodeActivationPayload;
    appName: string;
  }): string {
    const { payload, appName, recipientName } = args;
    const subtitle = payload.subtitle
      ? `<p style="color:#4b5563;margin:0 0 16px">${escapeHtml(payload.subtitle)}</p>`
      : '';
    const image =
      payload.imageUrl?.trim()
        ? `<p style="margin:0 0 16px"><img src="${escapeHtml(payload.imageUrl.trim())}" alt="" style="max-width:100%;border-radius:12px" /></p>`
        : '';
    return [
      `<p>Bonjour ${escapeHtml(recipientName)},</p>`,
      `<h2 style="margin:0 0 8px;color:#059669">${escapeHtml(payload.title)}</h2>`,
      subtitle,
      image,
      `<p style="font-size:18px;font-weight:700;margin:0 0 8px">${escapeHtml(payload.discountLabel)}</p>`,
      `<p style="margin:0 0 16px">Code : <strong>${escapeHtml(payload.code)}</strong></p>`,
      `<p style="margin:0 0 20px">Utilisez ce code dans votre panier ou consultez l’écran Promos de l’application ${escapeHtml(appName)}.</p>`,
      `<p style="margin:0"><a href="${escapeHtml(this.giftCodesDeepLink())}" style="display:inline-block;background:#059669;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Voir les offres</a></p>`,
    ].join('');
  }

  private buildEmailText(args: {
    recipientName: string;
    payload: GiftCodeActivationPayload;
    appName: string;
  }): string {
    const { payload, appName, recipientName } = args;
    const lines = [
      `Bonjour ${recipientName},`,
      '',
      payload.title,
      payload.subtitle || '',
      payload.discountLabel,
      `Code : ${payload.code}`,
      '',
      `Utilisez ce code dans votre panier ou consultez Promos dans ${appName}.`,
      this.giftCodesDeepLink(),
    ].filter((l) => l.trim().length > 0);
    return lines.join('\n');
  }

  private fcmAndroidChannelId(): string {
    return (
      this.config.get<string>('AD_NOTIFICATION_FCM_ANDROID_CHANNEL')?.trim() ||
      'african_meals_promotions'
    );
  }

  private async claimGiftCodeForNotify(
    giftCodeId: string,
  ): Promise<GiftCodeActivationPayload | null> {
    if (!Types.ObjectId.isValid(giftCodeId)) return null;
    const now = new Date();
    const doc = await this.giftCodeModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(giftCodeId),
          enabled: true,
          validUntil: { $gte: now },
          $or: [
            { activationNotifiedAt: { $exists: false } },
            { activationNotifiedAt: null },
          ],
        },
        { $set: { activationNotifiedAt: now } },
        { new: true, lean: true },
      )
      .exec();
    if (!doc) return null;

    const raw = doc as Record<string, unknown>;
    const code = String(raw.code ?? '').trim();
    const title = String(raw.title ?? code).trim() || code;
    const imageRaw =
      typeof raw.imageUrl === 'string' && raw.imageUrl.trim()
        ? raw.imageUrl.trim()
        : null;
    const webBase = resolveEmailWebSiteBase(this.config);
    const imageUrl = imageRaw
      ? (await resolveEmailImageUrl(imageRaw, webBase)) ?? imageRaw
      : null;
    return {
      giftCodeId: String(raw._id ?? giftCodeId),
      code,
      title,
      subtitle: String(raw.subtitle ?? '').trim(),
      discountLabel: this.formatDiscountLabel(
        raw.discountType as GiftCodeDiscountTypeEnum,
        Number(raw.value ?? 0),
      ),
      imageUrl,
    };
  }

  private async listCustomerRecipients(): Promise<RecipientRow[]> {
    const docs = await this.userModel
      .find({ type: UserTypeEnum.USER })
      .select('_id email fullName')
      .limit(MAX_USERS)
      .lean()
      .exec();
    return docs.map((u) => {
      const raw = u as Record<string, unknown>;
      return {
        userId: String(raw._id ?? ''),
        email: String(raw.email ?? '')
          .trim()
          .toLowerCase(),
        fullName: String(raw.fullName ?? '').trim() || 'Client',
      };
    });
  }

  private async notifyRecipient(
    recipient: RecipientRow,
    payload: GiftCodeActivationPayload,
    pushTitle: string,
    pushBody: string,
    pushData: Record<string, string>,
    appName: string,
  ): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (recipient.email) {
      tasks.push(
        (async () => {
          try {
            await this.mailer.sendAdNotificationEmail({
              to: recipient.email,
              toName: recipient.fullName,
              subject: `${appName} — ${payload.title}`,
              html: this.buildEmailHtml({
                recipientName: recipient.fullName,
                payload,
                appName,
              }),
              text: this.buildEmailText({
                recipientName: recipient.fullName,
                payload,
                appName,
              }),
              logContext: 'gift-code-activation',
            });
          } catch (e) {
            this.logger.warn(
              `gift code email ${recipient.userId}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        })(),
      );
    }

    tasks.push(
      (async () => {
        try {
          const created = await this.notifications.createUserScopedNotification({
            recipientUserId: recipient.userId,
            title: pushTitle,
            body: pushBody,
            type: 'gift_code_promo',
            data: pushData,
            sendPush: false,
          });
          const fcmData = {
            ...pushData,
            notificationId: created.id,
          };
          await this.notifications.sendMulticastNotification({
            recipientUserIds: [recipient.userId],
            title: pushTitle,
            body: pushBody.slice(0, 500),
            data: fcmData,
            androidChannelId: this.fcmAndroidChannelId(),
          });
          this.wsInboxNotify.notifyUserInboxRefresh(recipient.userId);
        } catch (e) {
          this.logger.warn(
            `gift code push ${recipient.userId}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      })(),
    );

    await Promise.all(tasks);
  }

  async runActivationNotify(giftCodeId: string): Promise<void> {
    try {
      const payload = await this.claimGiftCodeForNotify(giftCodeId);
      if (!payload) return;

      const recipients = await this.listCustomerRecipients();
      if (!recipients.length) {
        this.logger.log(`gift code ${giftCodeId}: aucun client à notifier`);
        return;
      }

      const appName = this.platformName();
      const pushTitle = payload.title;
      const pushBody =
        payload.subtitle ||
        `${payload.discountLabel} — code ${payload.code}`;
      const pushData = this.buildPushData(payload);

      this.logger.log(
        `gift code activation notify ${giftCodeId}: ${recipients.length} client(s)`,
      );

      for (let i = 0; i < recipients.length; i += USER_BATCH_SIZE) {
        const slice = recipients.slice(i, i + USER_BATCH_SIZE);
        await this.mapPool(slice, USER_PARALLEL, async (recipient) => {
          await this.notifyRecipient(
            recipient,
            payload,
            pushTitle,
            pushBody.slice(0, 500),
            pushData,
            appName,
          );
        });
      }

      this.logger.log(
        `gift code activation notify ${giftCodeId}: terminé (${recipients.length} client(s))`,
      );
    } catch (e) {
      this.logger.error(
        `gift code activation notify ${giftCodeId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
