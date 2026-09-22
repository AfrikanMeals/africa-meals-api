import { UserTypeEnum } from '@schemas/user.schema';
import {
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
});
