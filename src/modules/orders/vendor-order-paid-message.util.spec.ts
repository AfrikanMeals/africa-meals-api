import {
  buildVendorOrderPaidInboxMessage,
  buildVendorOrderPaidPushBody,
  buildVendorOrderPayOnPickupInboxMessage,
  buildVendorOrderPayOnPickupPushBody,
  buildVendorOrderStatusInboxMessage,
  buildVendorPreOrderDDayInboxMessage,
} from './vendor-order-paid-message.util';

const base = {
  orderId: '507f1f77bcf86cd799439011',
  items: [{ label: 'Thieb', quantity: 1, price: 12 } as never],
  totalPrice: 12,
  currency: 'CAD',
  pickupCode: 'AB12CD',
  storeName: 'Chez Fatou',
};

describe('vendor order messages — pas de code retrait', () => {
  it('inbox payée n’inclut pas le code', () => {
    const msg = buildVendorOrderPaidInboxMessage(base);
    expect(msg).not.toMatch(/Code retrait|AB12CD/i);
  });

  it('push payée n’inclut pas le code', () => {
    const msg = buildVendorOrderPaidPushBody(base);
    expect(msg).not.toMatch(/Code |AB12CD/i);
  });

  it('inbox pay-on-pickup n’inclut pas le code', () => {
    const msg = buildVendorOrderPayOnPickupInboxMessage(base);
    expect(msg).not.toMatch(/Code retrait|AB12CD/i);
  });

  it('push pay-on-pickup n’inclut pas le code', () => {
    const msg = buildVendorOrderPayOnPickupPushBody(base);
    expect(msg).not.toMatch(/Code |AB12CD/i);
  });

  it('inbox pré-commande J-day n’inclut pas le code', () => {
    const msg = buildVendorPreOrderDDayInboxMessage(base);
    expect(msg).not.toMatch(/Code retrait|AB12CD/i);
  });

  it('inbox payée inclut compléments snake_case', () => {
    const msg = buildVendorOrderPaidInboxMessage({
      ...base,
      items: [
        {
          label: 'Burger',
          quantity: 1,
          price: 10,
          selected_complements: [
            { title: 'Sauce', options: [{ label: 'Piment' }] },
          ],
          selected_supplements: [{ name: 'Bacon', price: 2 }],
          selected_variant_label: 'Large',
        } as never,
      ],
    })
    expect(msg).toContain('Burger')
    expect(msg).toContain('Large')
    expect(msg).toContain('Piment')
    expect(msg).toContain('Bacon')
  })

  it('inbox statut n’inclut pas le code', () => {
    const msg = buildVendorOrderStatusInboxMessage({
      ...base,
      statusLabel: 'Prête pour retrait',
    });
    expect(msg).not.toMatch(/Code retrait|AB12CD/i);
  });
});
