import {
  campaignBundleItemKey,
  isCampaignBundleItem,
} from './ad-campaign-bundle-item.util';

describe('ad-campaign-bundle-item.util', () => {
  it('détecte un item BUNDLE valide', () => {
    expect(
      isCampaignBundleItem({
        itemType: 'BUNDLE',
        productBundleId: ' 507f1f77bcf86cd799439011 ',
      }),
    ).toBe(true);
    expect(
      isCampaignBundleItem({ itemType: 'PRODUCT', productBundleId: 'x' }),
    ).toBe(false);
    expect(isCampaignBundleItem({ itemType: 'BUNDLE' })).toBe(false);
  });

  it('clé de dédup B:', () => {
    expect(campaignBundleItemKey('abc')).toBe('B:abc');
  });
});
