import {
  buildInvoiceEmailJsonLd,
  buildOrderEmailJsonLd,
  buildOrderReceiptEmailJsonLd,
  orderReceiptEmailSubject,
  resolveOrderEmailPublicUrl,
  resolveProductPublicUrl,
} from './order-invoice.util';

describe('order-invoice.util Gmail markup', () => {
  const snapshot = {
    orderId: '507f1f77bcf86cd799439011',
    storeId: 'store456',
    createdAt: '2026-06-07T12:00:00.000Z',
    status: 'paied',
    totalPrice: 15.07,
    shippingPrice: 0,
    taxTotal: 0,
    currency: 'CAD',
    couponCode: 'PROMO10',
    storeName: 'Resto 102',
    clientName: 'Boris',
    clientEmail: 'boris@example.com',
    deliveryLine: 'Centre, Yaoundé',
    deliveryAddressSnapshot: {
      address: '123 Main St',
      city: 'Yaoundé',
      zipCode: '0000',
      countryCode: 'CM',
    },
    items: [
      {
        label: 'Okok',
        quantity: 1,
        price: 17.07,
        entityId: 'prod123',
        pictureUrl: 'https://cdn.example/okok.jpg',
      } as never,
    ],
  };

  const opts = {
    ref: 'AE95ED9A',
    orderUrl: 'https://wise-eat.com/orders/abc',
    publicWebUrl: 'https://wise-eat.com',
  };

  it('builds subject with Receipt and Invoice keywords', () => {
    expect(orderReceiptEmailSubject('Resto 102', 'AE95ED9A')).toBe(
      'Resto 102 Receipt & Invoice #AE95ED9A',
    );
  });

  it('resolves order URL from template or public web base', () => {
    expect(
      resolveOrderEmailPublicUrl('abc123', {
        orderUrlTemplate: 'https://wise-eat.com/orders/{orderId}',
      }),
    ).toBe('https://wise-eat.com/orders/abc123');
    expect(
      resolveOrderEmailPublicUrl('abc123', {
        publicWebUrl: 'https://wise-eat.com',
      }),
    ).toBe('https://wise-eat.com/orders/abc123');
  });

  it('resolves product URL from store and entity id', () => {
    expect(
      resolveProductPublicUrl('store456', 'prod123', 'https://wise-eat.com'),
    ).toBe('https://wise-eat.com/stores/store456/products/prod123');
    expect(
      resolveProductPublicUrl(
        'store456',
        'prod123',
        'https://wise-eat.com',
        'Resto 102',
        'Okok',
      ),
    ).toBe(
      'https://wise-eat.com/stores/store456-resto-102/products/prod123-okok',
    );
  });

  it('builds billing Order JSON-LD aligned with Google docs', () => {
    const jsonLd = buildOrderEmailJsonLd(snapshot, opts);

    expect(jsonLd['@context']).toBe('http://schema.org');
    expect(jsonLd['@type']).toBe('Order');
    expect(jsonLd.merchant).toEqual({
      '@type': 'Organization',
      name: 'Resto 102',
    });
    expect(jsonLd.orderNumber).toBe('AE95ED9A');
    expect(jsonLd.orderDate).toBe('2026-06-07T12:00:00.000Z');
    expect(jsonLd.price).toBe('15.07');
    expect(jsonLd.priceCurrency).toBe('CAD');
    expect(jsonLd.discount).toBe('2.00');
    expect(jsonLd.discountCurrency).toBe('CAD');
    expect(jsonLd.orderStatus).toBe('http://schema.org/OrderProcessing');
    expect(jsonLd.priceSpecification).toEqual({
      '@type': 'PriceSpecification',
      validFrom: '2026-06-07T12:00:00.000Z',
    });
    expect(jsonLd.paymentMethod).toEqual({
      '@type': 'PaymentMethod',
      name: 'http://schema.org/CreditCard',
    });
    expect(jsonLd.customer).toEqual({ '@type': 'Person', name: 'Boris' });
    expect(jsonLd.isGift).toBe('false');
    expect(jsonLd.url).toBe('https://wise-eat.com/orders/abc');
    expect(jsonLd.potentialAction).toEqual({
      '@type': 'ViewAction',
      url: 'https://wise-eat.com/orders/abc',
    });
    expect(jsonLd.billingAddress).toMatchObject({
      '@type': 'PostalAddress',
      streetAddress: '123 Main St',
      addressLocality: 'Yaoundé',
    });

    const offer = jsonLd.acceptedOffer as Record<string, unknown>;
    expect(Array.isArray(offer)).toBe(false);
    expect(offer.itemOffered).toEqual({
      '@type': 'Product',
      name: 'Okok',
      sku: 'prod123',
      image: 'https://cdn.example/okok.jpg',
      url: 'https://wise-eat.com/stores/store456-resto-102/products/prod123-okok',
    });
    expect(offer.price).toBe('17.07');
    expect(offer.priceCurrency).toBe('CAD');
    expect(offer.seller).toEqual({
      '@type': 'Organization',
      name: 'Resto 102',
    });
    expect(
      (offer.eligibleQuantity as { value: string }).value,
    ).toBe('1');
  });

  it('builds Invoice JSON-LD with referencesOrder', () => {
    const order = buildOrderEmailJsonLd(snapshot, opts);
    const invoice = buildInvoiceEmailJsonLd(snapshot, opts, order);

    expect(invoice['@type']).toBe('Invoice');
    expect(invoice.accountId).toBe('AE95ED9A');
    expect(invoice.confirmationNumber).toBe('AE95ED9A');
    expect(invoice.paymentStatus).toBe('PaymentAutomaticallyApplied');
    expect(invoice.totalPaymentDue).toEqual({
      '@type': 'PriceSpecification',
      price: '15.07',
      priceCurrency: 'CAD',
    });
    expect(invoice.minimumPaymentDue).toEqual({
      '@type': 'PriceSpecification',
      price: '0.00',
      priceCurrency: 'CAD',
    });
    expect(invoice.paymentDue).toBe('2026-06-07');
    expect(invoice.scheduledPaymentDate).toBe('2026-06-07');
    expect(invoice.referencesOrder).toMatchObject({
      '@type': 'Order',
      orderNumber: 'AE95ED9A',
      merchant: { '@type': 'Organization', name: 'Resto 102' },
    });
  });

  it('returns Order + Invoice blocks for paid receipt emails', () => {
    const blocks = buildOrderReceiptEmailJsonLd(snapshot, opts);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.['@type']).toBe('Order');
    expect(blocks[1]?.['@type']).toBe('Invoice');
  });
});
