import { shouldFallbackDeliveryPayoutToStoreOwner } from './vendor-self-delivery-payout.util';
import { UserTypeEnum } from '@schemas/user.schema';

describe('vendor-self-delivery-payout.util', () => {
  it('does not fallback when agent Connect is ready', () => {
    expect(
      shouldFallbackDeliveryPayoutToStoreOwner({
        agentReady: true,
        agentHasAccount: true,
        assigneeType: UserTypeEnum.VENDOR,
      }),
    ).toBe(false);
  });

  it('falls back for vendor assignee without Connect', () => {
    expect(
      shouldFallbackDeliveryPayoutToStoreOwner({
        agentReady: false,
        agentHasAccount: false,
        assigneeType: UserTypeEnum.VENDOR,
      }),
    ).toBe(true);
  });

  it('does not fallback for delivery agent without Connect', () => {
    expect(
      shouldFallbackDeliveryPayoutToStoreOwner({
        agentReady: false,
        agentHasAccount: false,
        assigneeType: UserTypeEnum.DELIVERY,
      }),
    ).toBe(false);
  });
});
