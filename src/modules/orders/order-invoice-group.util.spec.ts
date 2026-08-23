import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import type { OrdeLineItem } from '@schemas/order.schema';
import {
  groupOrderLinesForDisplay,
  lineCustomizationText,
  orderLineDisplayLabel,
} from './order-invoice.util';

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

  it('lit perso snake_case lean (compléments / suppléments / variante)', () => {
    const text = lineCustomizationText({
      label: 'Burger',
      quantity: 1,
      price: 10,
      itemType: CartItemTypeEnum.PRODUCT,
      selected_variant_label: 'Large',
      selected_complements: [
        {
          title: 'Sauce',
          options: [{ label: 'Piment', price_delta: 1 }],
        },
      ],
      selected_supplements: [{ name: 'Bacon', price: 2 }],
    } as never);
    expect(text).toContain('Variante : Large');
    expect(text).toContain('Sauce');
    expect(text).toContain('Piment');
    expect(text).toContain('Bacon');
  });

  it('regroupe un combo snake_case bundle_group_id', () => {
    const rows = groupOrderLinesForDisplay([
      line({
        label: 'Poulet',
        price: 8,
        bundle_group_id: 'g2',
        bundle_title: 'Menu Soir',
      } as never),
      line({
        label: 'Jus',
        price: 2,
        bundle_group_id: 'g2',
        bundle_title: 'Menu Soir',
      } as never),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('bundle');
    expect(rows[0].label).toBe('Menu Soir');
    expect(rows[0].subLabels).toEqual(['Poulet', 'Jus']);
  });

  it('préfixe Extra : pour product_extra', () => {
    expect(
      orderLineDisplayLabel({
        label: 'Frites',
        quantity: 1,
        price: 2,
        itemType: CartItemTypeEnum.PRODUCT_EXTRA,
      } as never),
    ).toBe('Extra : Frites');
  });
});
