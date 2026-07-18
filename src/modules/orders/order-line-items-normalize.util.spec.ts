import {
  normalizeOrderLineItemForApi,
  normalizeOrderItemsOnOrderRow,
} from './order-line-items-normalize.util';

describe('order-line-items-normalize.util', () => {
  it('expose camelCase depuis snake_case lean', () => {
    const out = normalizeOrderLineItemForApi({
      label: 'Poulet DG',
      selected_variant_label: 'Large',
      selected_complements: [
        {
          group_title: 'Accompagnement',
          options: [{ label: 'Riz', price_delta: 0 }],
        },
      ],
      selected_supplements: [{ name: 'Piment', price: 200 }],
    });
    expect(out.selectedVariantLabel).toBe('Large');
    expect(out.selectedComplements).toEqual([
      {
        groupTitle: 'Accompagnement',
        options: [{ label: 'Riz', priceDelta: 0 }],
      },
    ]);
    expect(out.selectedSupplements).toEqual([{ name: 'Piment', price: 200 }]);
    expect(out.selected_complements).toBeUndefined();
  });

  it('normalise items sur une commande', () => {
    const row = normalizeOrderItemsOnOrderRow({
      _id: 'o1',
      items: [
        {
          label: 'X',
          selectedVariantLabel: 'M',
          selectedComplements: [],
          selectedSupplements: [],
        },
      ],
    });
    expect((row.items as unknown[])[0]).toMatchObject({
      label: 'X',
      selectedVariantLabel: 'M',
      selectedComplements: [],
      selectedSupplements: [],
    });
  });
});
