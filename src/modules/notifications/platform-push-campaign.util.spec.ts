import { UserTypeEnum } from '@schemas/user.schema';
import {
  advanceCampaignCursor,
  campaignJobShouldSend,
  mapPlatformPushCampaignAudience,
  normalizePlatformPushCampaignAudiences,
  userTypesForPlatformPushAudiences,
} from './platform-push-campaign.util';

describe('platform-push-campaign.util', () => {
  describe('mapPlatformPushCampaignAudience', () => {
    it('mappe CUSTOMER → USER + customer', () => {
      expect(mapPlatformPushCampaignAudience('CUSTOMER')).toEqual({
        userType: UserTypeEnum.USER,
        fcmAudience: 'customer',
      });
    });

    it('mappe VENDOR → VENDOR + vendor', () => {
      expect(mapPlatformPushCampaignAudience('VENDOR')).toEqual({
        userType: UserTypeEnum.VENDOR,
        fcmAudience: 'vendor',
      });
    });

    it('mappe COURIER → DELIVERY + courier', () => {
      expect(mapPlatformPushCampaignAudience('COURIER')).toEqual({
        userType: UserTypeEnum.DELIVERY,
        fcmAudience: 'courier',
      });
    });
  });

  describe('normalizePlatformPushCampaignAudiences', () => {
    it('déduplique, upper-case et ordonne CUSTOMER → VENDOR → COURIER', () => {
      expect(
        normalizePlatformPushCampaignAudiences([
          'courier',
          'CUSTOMER',
          'VENDOR',
          'CUSTOMER',
          'admin',
        ]),
      ).toEqual(['CUSTOMER', 'VENDOR', 'COURIER']);
    });

    it('retourne [] si aucune audience valide', () => {
      expect(normalizePlatformPushCampaignAudiences(['PARTNER', ''])).toEqual(
        [],
      );
    });
  });

  describe('userTypesForPlatformPushAudiences', () => {
    it('produit le filtre $in Mongo sans doublon', () => {
      expect(
        userTypesForPlatformPushAudiences(['CUSTOMER', 'COURIER', 'CUSTOMER']),
      ).toEqual([UserTypeEnum.USER, UserTypeEnum.DELIVERY]);
    });
  });

  describe('campaignJobShouldSend', () => {
    it('n’envoie pas le lot suivant si pause ou annulation', () => {
      expect(campaignJobShouldSend('paused')).toBe(false);
      expect(campaignJobShouldSend('cancelled')).toBe(false);
      expect(campaignJobShouldSend('completed')).toBe(false);
      expect(campaignJobShouldSend('running')).toBe(true);
      expect(campaignJobShouldSend('queued')).toBe(true);
    });
  });

  describe('advanceCampaignCursor', () => {
    it('reprend après le dernier id tant que le lot est plein', () => {
      expect(
        advanceCampaignCursor({
          audienceCount: 2,
          audienceIndex: 0,
          batchIds: ['a', 'b'],
          batchLimit: 2,
        }),
      ).toEqual({
        done: false,
        cursor: { audienceIndex: 0, lastUserId: 'b' },
      });
    });

    it('passe à l’audience suivante puis termine', () => {
      const next = advanceCampaignCursor({
        audienceCount: 2,
        audienceIndex: 0,
        batchIds: ['only'],
        batchLimit: 500,
      });
      expect(next.done).toBe(false);
      expect(next.cursor.audienceIndex).toBe(1);
      expect(next.cursor.lastUserId).toBeUndefined();

      const end = advanceCampaignCursor({
        audienceCount: 2,
        audienceIndex: 1,
        batchIds: [],
        batchLimit: 500,
      });
      expect(end.done).toBe(true);
    });
  });
});
