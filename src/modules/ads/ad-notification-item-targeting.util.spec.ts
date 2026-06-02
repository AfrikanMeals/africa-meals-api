import type { AdNotificationItemPayload } from './ad-notification-items.util';
import {
  categoryKeyFromTitle,
  pickTargetedCampaignItem,
} from './ad-notification-item-targeting.util';

const product = (
  id: string,
  title: string,
  categoryKey: string,
): AdNotificationItemPayload => ({
  itemType: 'PRODUCT',
  productId: id,
  drinkId: null,
  title,
  imageUrl: null,
  priceCad: 10,
  categoryKey,
});

describe('ad-notification-item-targeting.util', () => {
  it('categoryKeyFromTitle slugifies titles', () => {
    expect(categoryKeyFromTitle('Plats Africains')).toBe('plats_africains');
  });

  it('prefers item matching user interest and past purchase', () => {
    const items = [
      product('p1', 'Salade', 'salads'),
      product('p2', 'Poulet', 'poultry'),
    ];
    const picked = pickTargetedCampaignItem({
      items,
      userId: 'user-1',
      profile: {
        interestScores: { poultry: 0.9, salads: 0.1 },
        topCategories: ['poultry'],
      },
      purchasedProductIds: new Set(['p2']),
    });
    expect(picked?.productId).toBe('p2');
  });

  it('returns single item without profile', () => {
    const items = [product('only', 'Solo', 'x')];
    expect(
      pickTargetedCampaignItem({ items, userId: 'u' })?.productId,
    ).toBe('only');
  });
});
