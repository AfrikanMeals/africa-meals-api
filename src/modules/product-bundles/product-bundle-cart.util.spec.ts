import { planBundleCartLines } from './product-bundle-cart.util';

describe('planBundleCartLines', () => {
  it('ordonne par sortOrder et mappe product/drink', () => {
    const lines = planBundleCartLines([
      { itemType: 'drink', drinkId: 'd1', sortOrder: 2 },
      { itemType: 'product', productId: 'p1', sortOrder: 0 },
      { itemType: 'product', productId: 'p2', sortOrder: 1 },
    ]);
    expect(lines.map((l) => l.itemId)).toEqual(['p1', 'p2', 'd1']);
    expect(lines.map((l) => l.type)).toEqual(['product', 'product', 'drink']);
  });

  it('ignore les items sans id', () => {
    expect(
      planBundleCartLines([
        { itemType: 'product', sortOrder: 0 },
        { itemType: 'drink', drinkId: 'd9', sortOrder: 1 },
      ]),
    ).toEqual([{ itemIndex: 1, type: 'drink', itemId: 'd9' }]);
  });
});
