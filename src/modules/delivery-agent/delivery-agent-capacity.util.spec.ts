import { PendingDeliveryProofStatusEnum } from '@schemas/pending-delivery-proof.schema';
import {
  COURIER_DUTY_RELEASED_PROOF_STATUSES,
  courierActiveDutyLookupStages,
  maxConcurrentOrdersFromApplication,
  pendingDeliveryProofIdFromRow,
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

  it('pendingDeliveryProofIdFromRow lit camel et snake', () => {
    expect(
      pendingDeliveryProofIdFromRow({ pendingDeliveryProofId: 'abc' }),
    ).toBe('abc');
    expect(
      pendingDeliveryProofIdFromRow({ pending_delivery_proof_id: 'def' }),
    ).toBe('def');
    expect(pendingDeliveryProofIdFromRow({})).toBeNull();
  });

  it('courierActiveDutyLookupStages lit camelCase et snake_case', () => {
    const stages = courierActiveDutyLookupStages();
    const addFields = stages[0] as { $addFields?: { _dutyProofId?: unknown } };
    expect(addFields.$addFields?._dutyProofId).toEqual({
      $ifNull: ['$pendingDeliveryProofId', '$pending_delivery_proof_id'],
    });
  });
});
