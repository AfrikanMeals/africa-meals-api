import { OrderStatusEnum } from '@schemas/order.schema';
import {
  isVendorPickupConfirmableStatus,
  vendorPickupOrderRef,
} from './vendor-pickup-preview.util';

describe('vendor-pickup-preview.util', () => {
  describe('isVendorPickupConfirmableStatus', () => {
    it('autorise approved / paied / awaiting_cash', () => {
      expect(isVendorPickupConfirmableStatus(OrderStatusEnum.APPROVED)).toBe(
        true,
      );
      expect(isVendorPickupConfirmableStatus(OrderStatusEnum.PAIED)).toBe(true);
      expect(
        isVendorPickupConfirmableStatus(OrderStatusEnum.AWAITING_CASH),
      ).toBe(true);
    });

    it('refuse created / shipped / completed / cancelled', () => {
      expect(isVendorPickupConfirmableStatus(OrderStatusEnum.CREATED)).toBe(
        false,
      );
      expect(isVendorPickupConfirmableStatus(OrderStatusEnum.SHIPPED)).toBe(
        false,
      );
      expect(isVendorPickupConfirmableStatus(OrderStatusEnum.COMPLETED)).toBe(
        false,
      );
      expect(isVendorPickupConfirmableStatus(OrderStatusEnum.CANCELLED)).toBe(
        false,
      );
    });
  });

  describe('vendorPickupOrderRef', () => {
    it('prend les 6 derniers caractères en majuscules', () => {
      expect(vendorPickupOrderRef('507f1f77bcf86cd799439011')).toBe('#439011');
    });
  });
});
