import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AdNotificationDispatchCron } from '@modules/ads/ad-notification-dispatch.cron';
import { AdNotificationDispatchQueueService } from '@modules/ads/ad-notification-dispatch-queue.service';
import { AdNotificationEntityTypeEnum } from '@schemas/ad-notification-event.schema';
import { AdNotificationPricingSettingsModel } from '@schemas/ad-notification-pricing-settings.schema';
import { AdCampaignModel } from '@schemas/ad-campaign.schema';
import { AdModel } from '@schemas/ad.schema';
import { OrderModel } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Types } from 'mongoose';
import { MailerService } from '@modules/mailer/mailer.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { AdNotificationEventModel } from '@schemas/ad-notification-event.schema';
import { AdNotificationService } from './ad-notification.service';

describe('Ad notification dispatch (integration)', () => {
  const storeId = new Types.ObjectId();
  const adId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  let moduleRef: TestingModule;
  let adNotifications: AdNotificationService;
  let cron: AdNotificationDispatchCron;
  let dispatchQueue: AdNotificationDispatchQueueService;
  let sendMulticast: jest.Mock;
  let createInbox: jest.Mock;
  let enqueueEntityDispatch: jest.Mock;

  const adModel = {
    countDocuments: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const campaignModel = {
    countDocuments: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const eventModel = { insertMany: jest.fn().mockResolvedValue([]), create: jest.fn() };
  const orderModel = {
    distinct: jest.fn().mockResolvedValue([userId.toString()]),
  };
  const userModel = {
    find: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: userId,
              email: 'client@example.com',
              phoneNumber: '+15145551234',
              fullName: 'Client Test',
            },
          ]),
        }),
      }),
    }),
  };
  const storeModel = {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ name: 'Restaurant Test' }),
        }),
      }),
    }),
  };
  const pricingModel = {
    findOne: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          key: 'default',
          availableChannels: {
            email: true,
            push: true,
            inApp: true,
            sms: true,
            whatsapp: true,
          },
        }),
      }),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sendMulticast = jest
      .fn()
      .mockResolvedValue({ sent: 1, failures: 0, deviceCount: 1 });
    createInbox = jest.fn().mockResolvedValue({ id: 'inbox-notif-1' });
    enqueueEntityDispatch = jest.fn().mockResolvedValue(undefined);

    moduleRef = await Test.createTestingModule({
      providers: [
        AdNotificationService,
        AdNotificationDispatchCron,
        {
          provide: AdNotificationDispatchQueueService,
          useFactory: (svc: AdNotificationService) => ({
            isEnabled: () => false,
            enqueuePendingDispatches: jest.fn(),
            enqueueEntityDispatch,
            enqueueRecipientBatch: (payload: unknown) =>
              svc.processRecipientBatchJob(
                payload as Parameters<
                  AdNotificationService['processRecipientBatchJob']
                >[0],
              ),
          }),
          inject: [AdNotificationService],
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string> = {
                PUBLIC_WEB_URL: 'https://web.test',
                MOBILE_DEEP_LINK_SCHEME: 'wise-eat',
                AD_NOTIFICATION_FCM_ANDROID_CHANNEL: 'african_meals_promotions',
              };
              return map[key];
            },
          },
        },
        { provide: getModelToken(AdModel.name), useValue: adModel },
        { provide: getModelToken(AdCampaignModel.name), useValue: campaignModel },
        {
          provide: getModelToken(AdNotificationEventModel.name),
          useValue: eventModel,
        },
        { provide: getModelToken(OrderModel.name), useValue: orderModel },
        { provide: getModelToken(UserModel.name), useValue: userModel },
        { provide: getModelToken(StoreModel.name), useValue: storeModel },
        {
          provide: getModelToken(AdNotificationPricingSettingsModel.name),
          useValue: pricingModel,
        },
        {
          provide: NotificationsService,
          useValue: {
            sendMulticastNotification: sendMulticast,
            createUserScopedNotification: createInbox,
          },
        },
        {
          provide: MailerService,
          useValue: { sendAdNotificationEmail: jest.fn() },
        },
      ],
    }).compile();

    adNotifications = moduleRef.get(AdNotificationService);
    cron = moduleRef.get(AdNotificationDispatchCron);
    dispatchQueue = moduleRef.get(AdNotificationDispatchQueueService);
  });

  it('scheduleImmediateDispatch enqueue une bannière éligible', async () => {
    adModel.countDocuments.mockResolvedValue(1);
    adNotifications.scheduleImmediateDispatch({
      kind: 'banner',
      entityId: adId.toString(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(enqueueEntityDispatch).toHaveBeenCalledWith({
      kind: 'banner',
      entityId: adId.toString(),
    });
  });

  it('scheduleImmediateDispatch ignore une entité non éligible', async () => {
    adModel.countDocuments.mockResolvedValue(0);
    adNotifications.scheduleImmediateDispatch({
      kind: 'banner',
      entityId: adId.toString(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(enqueueEntityDispatch).not.toHaveBeenCalled();
  });

  it('cron runDispatchPass → lot push déclenche FCM', async () => {
    const claimedDoc = {
      _id: adId,
      store: storeId,
      title: 'Promo été',
      subtitle: '20 % de rabais',
      notificationAddon: {
        enabled: true,
        channels: { email: false, push: true, inApp: false, sms: false, whatsapp: false },
      },
      audienceTotal: null,
    };
    adModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([claimedDoc]),
          }),
        }),
      }),
    });
    campaignModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    adModel.findOneAndUpdate.mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(claimedDoc),
      }),
    });

    await cron.runScheduledDispatch();

    expect(adModel.findOneAndUpdate).toHaveBeenCalled();
    expect(sendMulticast).toHaveBeenCalled();
    const fcmArgs = sendMulticast.mock.calls[0][0];
    expect(fcmArgs.recipientUserIds).toContain(userId.toString());
    expect(fcmArgs.data?.type).toBe('ad_promo');
    expect(fcmArgs.androidChannelId).toBe('african_meals_promotions');
    expect(eventModel.insertMany).toHaveBeenCalled();
  });

  it('processRecipientBatchJob in-app + push : inbox puis un seul FCM', async () => {
    await adNotifications.processRecipientBatchJob({
      entityType: AdNotificationEntityTypeEnum.BANNER,
      entityId: adId.toString(),
      adId: adId.toString(),
      storeId: storeId.toString(),
      storeName: 'Restaurant Test',
      title: 'Promo',
      body: 'Corps',
      addon: {
        enabled: true,
        channels: {
          email: false,
          push: true,
          inApp: true,
          sms: false,
          whatsapp: false,
        },
      },
      recipients: [
        {
          userId: userId.toString(),
          email: 'client@example.com',
          phone: '+15145551234',
          fullName: 'Client',
        },
      ],
    });

    expect(createInbox).toHaveBeenCalledTimes(1);
    expect(sendMulticast).toHaveBeenCalledTimes(1);
    expect(sendMulticast.mock.calls[0][0].data?.notificationId).toBe(
      'inbox-notif-1',
    );
  });
});
