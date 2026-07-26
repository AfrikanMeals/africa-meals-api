import { mergePartnerSubscriptionAdminRow } from './partner-subscription-admin-list.util';

describe('partner-subscription-admin-list.util', () => {
  it('enrichit avec ownerName / ownerEmail', () => {
    const row = mergePartnerSubscriptionAdminRow({
      mapped: {
        id: 's1',
        ownerId: 'u1',
        planName: 'FREE',
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        isTrial: true,
        isOffer: false,
      },
      ownerName: '  Kode102 Inc. ',
      ownerEmail: 'a@b.com',
    });
    expect(row.ownerName).toBe('Kode102 Inc.');
    expect(row.ownerEmail).toBe('a@b.com');
    expect(row.isTrial).toBe(true);
  });
});
