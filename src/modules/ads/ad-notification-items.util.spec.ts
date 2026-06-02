import {
  buildAdNotificationEmailBodyHtml,
  campaignItemsToFcmValue,
  mapBannerToNotificationItems,
  mapPopulatedCampaignItems,
  parseCampaignItemsFromFcmValue,
} from './ad-notification-items.util';

describe('ad-notification-items.util', () => {
  it('mapPopulatedCampaignItems maps product and drink rows', () => {
    const items = mapPopulatedCampaignItems([
      {
        itemType: 'PRODUCT',
        product: {
          _id: '507f1f77bcf86cd799439011',
          title: 'Poulet braisé',
          profileImage: 'https://cdn.example/p.jpg',
          price: 12.5,
        },
      },
      {
        itemType: 'DRINK',
        drink: {
          _id: '507f1f77bcf86cd799439012',
          name: 'Jus bissap',
          imageUrl: 'https://cdn.example/d.jpg',
          priceCad: 4,
        },
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Poulet braisé');
    expect(items[1].itemType).toBe('DRINK');
  });

  it('campaignItemsToFcmValue round-trips via parseCampaignItemsFromFcmValue', () => {
    const items = mapBannerToNotificationItems({
      title: 'Promo été',
      imageUrl: 'https://cdn.example/b.jpg',
    });
    const fcm = campaignItemsToFcmValue(items);
    expect(fcm).toBeDefined();
    const parsed = parseCampaignItemsFromFcmValue(fcm);
    expect(parsed[0].title).toBe('Promo été');
    expect(parsed[0].imageUrl).toBe('https://cdn.example/b.jpg');
  });

  it('buildAdNotificationEmailBodyHtml lists items', () => {
    const html = buildAdNotificationEmailBodyHtml({
      recipientName: 'Alice',
      storeName: 'Chez Marie',
      title: 'Menu spécial',
      body: 'Découvrez nos plats.',
      webUrl: 'https://example.com/o',
      items: [
        {
          itemType: 'PRODUCT',
          productId: 'a',
          drinkId: null,
          title: 'Attiéké',
          imageUrl: 'https://cdn.example/a.jpg',
          priceCad: 9.99,
        },
      ],
    });
    expect(html).toContain('Attiéké');
    expect(html).toContain('9.99');
    expect(html).toContain('https://example.com/o');
  });
});
