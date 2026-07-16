import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import type { OrdeLineItem } from '@schemas/order.schema';
import { groupOrderLinesForDisplay } from './order-invoice.util';

function line(
  partial: Partial<OrdeLineItem> & { label: string; price: number },
): OrdeLineItem {
  return {
    itemType: CartItemTypeEnum.PRODUCT,
    quantity: 1,
    ...partial,
  } as OrdeLineItem;
}

describe('groupOrderLinesForDisplay', () => {
  it('laisse les lignes sans bundleGroupId inchangées', () => {
    const rows = groupOrderLinesForDisplay([
      line({ label: 'Riz', price: 5 }),
      line({ label: 'Sauce', price: 3 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('single');
    expect(rows[0].label).toBe('Riz');
    expect(rows[1].label).toBe('Sauce');
  });

  it('regroupe un combo en une ligne avec sous-libellés', () => {
    const rows = groupOrderLinesForDisplay([
      line({
        label: 'Poulet',
        price: 8,
        bundleGroupId: 'g1',
        bundleTitle: 'Menu Midi',
      } as never),
      line({
        label: 'Jus',
        price: 2.4,
        itemType: CartItemTypeEnum.DRINK,
        bundleGroupId: 'g1',
        bundleTitle: 'Menu Midi',
      } as never),
      line({ label: 'Extra alone', price: 1 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('bundle');
    expect(rows[0].label).toBe('Menu Midi');
    expect(rows[0].unitPrice).toBeCloseTo(10.4, 10);
    expect(rows[0].subLabels).toEqual(['Poulet', 'Jus']);
    expect(rows[1].kind).toBe('single');
    expect(rows[1].label).toBe('Extra alone');
  });

  it('ne duplique pas un même bundleGroupId', () => {
    const rows = groupOrderLinesForDisplay([
      line({
        label: 'A',
        price: 5,
        bundleGroupId: 'same',
        bundleTitle: 'Combo',
      } as never),
      line({
        label: 'B',
        price: 5,
        bundleGroupId: 'same',
        bundleTitle: 'Combo',
      } as never),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceLines).toHaveLength(2);
  });
});
