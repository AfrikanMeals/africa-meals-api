import {
  giftOrderStripeMetadataChunk,
  resolveGiftOrderParties,
} from './gift-order.util';

describe('gift-order.util', () => {
  const payer = '507f1f77bcf86cd799439011';
  const recipient = '507f1f77bcf86cd799439012';

  it('sans destinataire → user = payeur, pas de paidBy', () => {
    expect(resolveGiftOrderParties({ payerUserId: payer })).toEqual({
      orderUserId: payer,
      isGift: false,
    });
    expect(
      resolveGiftOrderParties({
        payerUserId: payer,
        giftRecipientUserId: '  ',
      }),
    ).toEqual({ orderUserId: payer, isGift: false });
  });

  it('avec destinataire → user = destinataire, paidBy = offreur', () => {
    expect(
      resolveGiftOrderParties({
        payerUserId: payer,
        giftRecipientUserId: recipient,
      }),
    ).toEqual({
      orderUserId: recipient,
      paidByUserId: payer,
      isGift: true,
    });
  });

  it('self-gift → cannot_gift_self', () => {
    expect(() =>
      resolveGiftOrderParties({
        payerUserId: payer,
        giftRecipientUserId: payer,
      }),
    ).toThrow('cannot_gift_self');
  });

  it('metadata Stripe uniquement si destinataire + payeur', () => {
    expect(
      giftOrderStripeMetadataChunk({
        giftRecipientUserId: recipient,
        paidByUserId: payer,
      }),
    ).toEqual({
      gift_recipient_user_id: recipient,
      paid_by_user_id: payer,
    });
    expect(
      giftOrderStripeMetadataChunk({ giftRecipientUserId: recipient }),
    ).toEqual({});
  });
});
