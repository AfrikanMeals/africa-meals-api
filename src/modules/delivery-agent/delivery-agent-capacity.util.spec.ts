import { OrderStatusEnum } from '@schemas/order.schema';
import { PendingDeliveryProofStatusEnum } from '@schemas/pending-delivery-proof.schema';
import {
  COURIER_DUTY_RELEASED_PROOF_STATUSES,
  maxConcurrentOrdersFromApplication,
} from './delivery-agent-capacity.util';

describe('delivery-agent-capacity.util', () => {
  it('maxConcurrentOrdersFromApplication prefers stored capacity', () => {
    expect(maxConcurrentOrdersFromApplication({ maxConcurrentOrders: 3 })).toBe(
      3,
    );
  });

  it('COURIER_DUTY_RELEASED_PROOF_STATUSES covers dépôt / validation', () => {
    expect(COURIER_DUTY_RELEASED_PROOF_STATUSES).toEqual(
      expect.arrayContaining([
        PendingDeliveryProofStatusEnum.SUBMITTED,
        PendingDeliveryProofStatusEnum.CUSTOMER_CONFIRMED,
        PendingDeliveryProofStatusEnum.CUSTOMER_DISPUTED,
        PendingDeliveryProofStatusEnum.ADMIN_APPROVED,
      ]),
    );
    expect(COURIER_DUTY_RELEASED_PROOF_STATUSES).not.toContain(
      PendingDeliveryProofStatusEnum.ADMIN_REJECTED,
    );
  });

  it('active duty still requires SHIPPED status enum', () => {
    expect(OrderStatusEnum.SHIPPED).toBe('shipped');
  });
});
