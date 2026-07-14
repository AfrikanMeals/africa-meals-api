import { partitionChatPushRecipients } from './chat-push-recipients.util';

describe('partitionChatPushRecipients', () => {
  const customer = '507f1f77bcf86cd799439011';
  const owner = '507f1f77bcf86cd799439012';
  const staff = '507f1f77bcf86cd799439013';
  const courier = '507f1f77bcf86cd799439014';

  it('sépare client / livreur / équipe boutique et exclut l’expéditeur', () => {
    const r = partitionChatPushRecipients({
      recipientUserIds: [customer, owner, staff, courier],
      senderUserId: owner,
      vendorTeamUserIds: [owner, staff],
      courierUserId: courier,
    });
    expect(r.customerUserIds).toEqual([customer]);
    expect(r.courierUserIds).toEqual([courier]);
    expect(r.vendorUserIds).toEqual([staff]);
  });

  it('client → vendeur : équipe en vendor, pas le client', () => {
    const r = partitionChatPushRecipients({
      recipientUserIds: [customer, owner, staff],
      senderUserId: customer,
      vendorTeamUserIds: [owner, staff],
    });
    expect(r.customerUserIds).toEqual([]);
    expect(r.vendorUserIds.sort()).toEqual([owner, staff].sort());
    expect(r.courierUserIds).toEqual([]);
  });

  it('livreur → client (ORDER)', () => {
    const r = partitionChatPushRecipients({
      recipientUserIds: [customer, courier],
      senderUserId: courier,
      courierUserId: courier,
    });
    expect(r.customerUserIds).toEqual([customer]);
    expect(r.courierUserIds).toEqual([]);
  });
});
