import { OrderStatusEnum } from '@schemas/order.schema';
import {
  parseDeliveryHistoryPage,
  parseDeliveryHistoryTake,
  resolveDeliveryHistoryStatusFilter,
} from './delivery-agent-history.util';

describe('delivery-agent-history.util', () => {
  describe('resolveDeliveryHistoryStatusFilter', () => {
    it('maps pending → shipped', () => {
      expect(resolveDeliveryHistoryStatusFilter('pending')).toEqual([
        OrderStatusEnum.SHIPPED,
      ]);
    });

    it('maps cancelled → cancelled', () => {
      expect(resolveDeliveryHistoryStatusFilter('cancelled')).toEqual([
        OrderStatusEnum.CANCELLED,
      ]);
    });

    it('maps approved → completed', () => {
      expect(resolveDeliveryHistoryStatusFilter('approved')).toEqual([
        OrderStatusEnum.COMPLETED,
      ]);
    });

    it('defaults to shipped + completed', () => {
      expect(resolveDeliveryHistoryStatusFilter(undefined)).toEqual([
        OrderStatusEnum.SHIPPED,
        OrderStatusEnum.COMPLETED,
      ]);
      expect(resolveDeliveryHistoryStatusFilter('')).toEqual([
        OrderStatusEnum.SHIPPED,
        OrderStatusEnum.COMPLETED,
      ]);
    });
  });

  describe('pagination parsers', () => {
    it('parses page', () => {
      expect(parseDeliveryHistoryPage(2)).toBe(2);
      expect(parseDeliveryHistoryPage('3')).toBe(3);
      expect(parseDeliveryHistoryPage(0)).toBe(1);
      expect(parseDeliveryHistoryPage('x')).toBe(1);
    });

    it('parses take with cap', () => {
      expect(parseDeliveryHistoryTake(20)).toBe(20);
      expect(parseDeliveryHistoryTake(500)).toBe(100);
      expect(parseDeliveryHistoryTake(undefined)).toBe(20);
    });
  });
});
