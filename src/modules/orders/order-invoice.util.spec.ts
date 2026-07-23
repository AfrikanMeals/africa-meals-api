import {
  buildInvoiceEmailJsonLd,
  buildOrderEmailJsonLd,
  buildOrderReceiptEmailJsonLd,
  buildParcelDeliveryEmailJsonLd,
  estimateParcelDeliveryEtaMinutes,
  invoiceSnapshotCurrency,
  orderReceiptEmailSubject,
  ParcelDeliverySchemaStatus,
  resolveOrderEmailPublicUrl,
  resolveProductPublicUrl,
} from './order-invoice.util';

describe('invoiceSnapshotCurrency', () => {
  it('ignore CAD legacy si adresse boutique CM', () => {
    expect(
      invoiceSnapshotCurrency({
        currency: 'CAD',
        storeAddressSnapshot: { countryCode: 'CM' },
      }),
    ).toBe('XAF');
  });

  it('garde CAD pour boutique CA', () => {
    expect(
      invoiceSnapshotCurrency({
        currency: 'CAD',
        storeAddressSnapshot: { countryCode: 'CA' },
      }),
    ).toBe('CAD');
  });
});

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

  it('builds subject aligned with Gmail purchase card pattern', () => {
    expect(orderReceiptEmailSubject('Resto 102', 'AE95ED9A')).toBe(
      'Your Resto 102 order #AE95ED9A is now complete',
    );
  });

  it('resolves order URL from template, public web base, or wise-eat fallback', () => {
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
    expect(resolveOrderEmailPublicUrl('abc123', {})).toBe(
      'https://wise-eat.com/orders/abc123',
    );
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

    expect(jsonLd['@context']).toBe('https://schema.org');
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
    expect(jsonLd.orderStatus).toBe('https://schema.org/OrderProcessing');
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

  it('returns Order JSON-LD only for paid receipt emails', () => {
    const jsonLd = buildOrderReceiptEmailJsonLd(snapshot, opts);
    expect(jsonLd['@type']).toBe('Order');
    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd.orderNumber).toBe('AE95ED9A');
  });

  it('estimates parcel ETA minutes from distance', () => {
    expect(estimateParcelDeliveryEtaMinutes(2)).toBe(18);
    expect(estimateParcelDeliveryEtaMinutes()).toBe(45);
  });

  it('builds ParcelDelivery JSON-LD for shipped delivery emails', () => {
    const deliverySnapshot = {
      ...snapshot,
      shouldShip: true,
      carrierName: 'Jean Livreur',
      storeAddressSnapshot: {
        address: '10 Rue Commerce',
        city: 'Yaoundé',
        zipCode: '0000',
        countryCode: 'CM',
      },
      deliveryAddressSnapshot: {
        address: '123 Main St',
        city: 'Yaoundé',
        zipCode: '0000',
        countryCode: 'CM',
      },
    };

    const parcel = buildParcelDeliveryEmailJsonLd(deliverySnapshot, {
      ...opts,
      appName: 'Wise Eat',
    });

    expect(parcel).toBeDefined();
    expect(parcel!['@type']).toBe('ParcelDelivery');
    expect(parcel!['@context']).toBe('https://schema.org');
    expect(parcel!.trackingNumber).toBe('AE95ED9A');
    expect(parcel!.trackingUrl).toBe('https://wise-eat.com/orders/abc');
    expect(parcel!.expectedArrivalUntil).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(parcel!.carrier).toEqual({
      '@type': 'Organization',
      name: 'Jean Livreur',
    });
    expect(parcel!.deliveryAddress).toMatchObject({
      '@type': 'PostalAddress',
      streetAddress: '123 Main St',
      addressLocality: 'Yaoundé',
    });
    expect(parcel!.originAddress).toMatchObject({
      '@type': 'PostalAddress',
      streetAddress: '10 Rue Commerce',
    });
    expect(parcel!.itemShipped).toMatchObject({
      '@type': 'Product',
      name: 'Okok',
      sku: 'prod123',
    });
    expect(parcel!.partOfOrder).toMatchObject({
      '@type': 'Order',
      orderNumber: 'AE95ED9A',
      orderStatus: 'https://schema.org/OrderProcessing',
    });
    expect(parcel!.deliveryStatus).toBe('InTransit');
    expect(parcel!.potentialAction).toEqual({
      '@type': 'TrackAction',
      url: 'https://wise-eat.com/orders/abc',
    });
  });

  it('skips ParcelDelivery when order is pickup', () => {
    expect(
      buildParcelDeliveryEmailJsonLd(
        { ...snapshot, shouldShip: false },
        opts,
      ),
    ).toBeUndefined();
  });
});
