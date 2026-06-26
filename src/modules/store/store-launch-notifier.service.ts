import { NotificationsService } from '@modules/notifications/notifications.service';
import { WsInboxNotifyService } from '@modules/ws-notify/ws-inbox-notify.service';
import { isStripeConnectOnboardingCompleteUser } from '@modules/billing/stripe/stripe-connect-visibility';
import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { buildStoreAppDeepLink } from './store-launch-link.util';

const USER_BATCH_SIZE = 100;
const USER_PARALLEL = 10;
const MAX_USERS = 50_000;

type StoreLaunchPayload = {
  storeId: string;
  storeName: string;
  regionCode: string;
  ownerUserId: string;
  deepLink: string;
};

@Injectable()
export class StoreLaunchNotifierService {
  private readonly logger = new Logger(StoreLaunchNotifierService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly notifications: NotificationsService,
    private readonly wsInboxNotify: WsInboxNotifyService,
  ) {}

  /** Déclenchement asynchrone (approbation admin ou fin onboarding Stripe). */
  scheduleMaybeNotify(storeId: string): void {
    void this.runMaybeNotify(storeId);
  }

  /** Toutes les boutiques actives du vendeur pas encore annoncées. */
  scheduleNotifyForOwnerStores(ownerUserId: string): void {
    void this.runNotifyForOwnerStores(ownerUserId);
  }

  private appScheme(): string {
    return (
      this.config.get<string>('MOBILE_DEEP_LINK_SCHEME')?.trim() || 'wise-eat'
    );
  }

  private fcmAndroidChannelId(): string {
    return (
      this.config.get<string>('AD_NOTIFICATION_FCM_ANDROID_CHANNEL')?.trim() ||
      'african_meals_promotions'
    );
  }

  private platformName(): string {
    return this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
  }

  private async runNotifyForOwnerStores(ownerUserId: string): Promise<void> {
    if (!Types.ObjectId.isValid(ownerUserId)) return;
    const ownerOid = new Types.ObjectId(ownerUserId);
    const rows = await this.storeModel
      .find({
        owner: ownerOid,
        status: StoreStatusEnum.ACTIVE,
        $or: [
          { regionLaunchNotifiedAt: { $exists: false } },
          { regionLaunchNotifiedAt: null },
        ],
      })
      .select('_id')
      .lean()
      .exec();
    for (const row of rows) {
      const id = String((row as { _id?: unknown })._id ?? '');
      if (id) await this.runMaybeNotify(id);
    }
  }

  private async loadEligibleStore(
    storeId: string,
  ): Promise<StoreLaunchPayload | null> {
    if (!Types.ObjectId.isValid(storeId)) return null;
    const doc = await this.storeModel
      .findById(storeId)
      .populate({
        path: 'owner',
        select:
          'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue type',
      })
      .select('name region status acceptsOrders owner regionLaunchNotifiedAt')
      .lean()
      .exec();
    if (!doc) return null;

    const raw = doc as Record<string, unknown>;
    if (raw.status !== StoreStatusEnum.ACTIVE) return null;
    if (raw.acceptsOrders === false) return null;
    if (raw.regionLaunchNotifiedAt) return null;

    const regionCode = normalizeCountryCode(
      typeof raw.region === 'string' ? raw.region : null,
    );
    if (!regionCode) return null;

    const owner = raw.owner as Record<string, unknown> | null;
    if (!owner || !isStripeConnectOnboardingCompleteUser(owner)) return null;

    const ownerUserId = String(owner._id ?? '');
    const storeName = String(raw.name ?? '').trim() || 'Restaurant';
    return {
      storeId,
      storeName,
      regionCode,
      ownerUserId,
      deepLink: buildStoreAppDeepLink({
        appScheme: this.appScheme(),
        storeId,
        storeName,
      }),
    };
  }

  private async claimStoreLaunch(
    storeId: string,
  ): Promise<StoreLaunchPayload | null> {
    const eligible = await this.loadEligibleStore(storeId);
    if (!eligible) return null;

    const now = new Date();
    const claimed = await this.storeModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(storeId),
          status: StoreStatusEnum.ACTIVE,
          acceptsOrders: { $ne: false },
          $or: [
            { regionLaunchNotifiedAt: { $exists: false } },
            { regionLaunchNotifiedAt: null },
          ],
        },
        { $set: { regionLaunchNotifiedAt: now } },
        { new: false },
      )
      .select('_id')
      .lean()
      .exec();
    if (!claimed) return null;
    return eligible;
  }

  private async listRegionalCustomers(
    regionCode: string,
    excludeUserId: string,
  ): Promise<string[]> {
    const filter: Record<string, unknown> = {
      type: UserTypeEnum.USER,
      appCountryCode: regionCode,
      disabled: { $ne: true },
    };
    if (Types.ObjectId.isValid(excludeUserId)) {
      filter._id = { $ne: new Types.ObjectId(excludeUserId) };
    }

    const docs = await this.userModel
      .find(filter)
      .select('_id')
      .limit(MAX_USERS)
      .lean()
      .exec();

    return docs
      .map((u) => String((u as { _id?: unknown })._id ?? ''))
      .filter((id) => id.length > 0);
  }

  private buildPushData(payload: StoreLaunchPayload): Record<string, string> {
    return {
      type: 'new_store_launch',
      audience: 'customer',
      storeId: payload.storeId,
      storeName: payload.storeName,
      regionCode: payload.regionCode,
      deepLink: payload.deepLink,
    };
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

  private async notifyUser(
    userId: string,
    title: string,
    body: string,
    pushData: Record<string, string>,
  ): Promise<void> {
    try {
      const created = await this.notifications.createUserScopedNotification({
        recipientUserId: userId,
        title,
        body,
        type: 'new_store_launch',
        data: pushData,
        sendPush: false,
      });
      await this.notifications.sendMulticastNotification({
        recipientUserIds: [userId],
        title,
        body: body.slice(0, 500),
        data: {
          ...pushData,
          notificationId: created.id,
        },
        androidChannelId: this.fcmAndroidChannelId(),
      });
      this.wsInboxNotify.notifyUserInboxRefresh(userId);
    } catch (e) {
      this.logger.warn(
        `new store push ${userId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async runMaybeNotify(storeId: string): Promise<void> {
    try {
      const payload = await this.claimStoreLaunch(storeId);
      if (!payload) return;

      const recipients = await this.listRegionalCustomers(
        payload.regionCode,
        payload.ownerUserId,
      );
      if (!recipients.length) {
        this.logger.log(
          `store launch ${storeId} (${payload.regionCode}): aucun client régional à notifier`,
        );
        return;
      }

      const appName = this.platformName();
      const title = `Nouveau restaurant sur ${appName}`;
      const body = `${payload.storeName} vient d'ouvrir — découvrez le menu !`;
      const pushData = this.buildPushData(payload);

      this.logger.log(
        `store launch ${storeId} (${payload.regionCode}): ${recipients.length} client(s)`,
      );

      for (let i = 0; i < recipients.length; i += USER_BATCH_SIZE) {
        const slice = recipients.slice(i, i + USER_BATCH_SIZE);
        await this.mapPool(slice, USER_PARALLEL, async (userId) => {
          await this.notifyUser(userId, title, body, pushData);
        });
      }

      this.logger.log(
        `store launch ${storeId}: terminé (${recipients.length} client(s))`,
      );
    } catch (e) {
      this.logger.error(
        `store launch notify ${storeId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
