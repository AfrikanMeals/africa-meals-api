import {
  buildOrderReceiptEmailBodyHtml,
  buildOrderReceiptSummaryCardHtml,
} from './order-receipt-email-html.util';
import { OrderSchemaStatus } from './order-invoice.util';

describe('order-receipt-email-html.util', () => {
  const snapshot = {
    orderId: '507f1f77bcf86cd799439011',
    createdAt: '2026-06-07T12:00:00.000Z',
    status: 'paied',
    totalPrice: 15.07,
    shippingPrice: 0,
    taxTotal: 0,
    currency: 'CAD',
    storeName: 'Resto 102',
    clientName: 'Boris',
    clientEmail: 'boris@example.com',
    deliveryLine: 'Retrait sur place',
    items: [
      {
        label: 'Okok',
        quantity: 1,
        price: 15.07,
      } as never,
    ],
  };

  it('renders Gmail-style summary card', () => {
    const html = buildOrderReceiptSummaryCardHtml(snapshot, {
      ref: 'AE95ED9A',
      orderUrl: 'https://wise-eat.com/orders/abc',
      currency: 'CAD',
      appName: 'Wise Eat',
    });

    expect(html).toContain('Commande chez Resto 102');
    expect(html).toContain('Articles&nbsp;: Okok');
    expect(html).toMatch(/15,07\s*\$/);
  });

  it('renders product table with Schema.org microdata', () => {
    const html = buildOrderReceiptEmailBodyHtml(snapshot, {
      ref: 'AE95ED9A',
      orderUrl: 'https://wise-eat.com/orders/abc',
      orderDateIso: '2026-06-07T12:00:00.000Z',
      orderStatusUri: OrderSchemaStatus.delivered,
      currency: 'CAD',
    });

    expect(html).toContain('itemtype="http://schema.org/Order"');
    expect(html).toContain('itemprop="orderNumber"');
    expect(html).toContain('Okok');
    expect(html).toContain('Sous-total');
    expect(html).toContain('Total');
    expect(html).toContain('Commande #AE95ED9A');
  });
});
