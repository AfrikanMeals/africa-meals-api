import {
  customizationSummaryLabel,
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
  normalizeSelectedVariantLabel,
} from './cart-customization.util';

describe('cart-customization.util', () => {
  it('normalise compléments camelCase et snake_case', () => {
    expect(
      normalizeSelectedComplements([
        {
          groupTitle: 'Sauce',
          options: [{ label: 'Piment', priceDelta: 1 }],
        },
      ]),
    ).toEqual([
      {
        groupTitle: 'Sauce',
        options: [{ label: 'Piment', priceDelta: 1 }],
      },
    ]);
    expect(
      normalizeSelectedComplements([
        {
          group_title: 'Sauce',
          options: [{ label: 'Piment', price_delta: 2 }],
        },
      ]),
    ).toEqual([
      {
        groupTitle: 'Sauce',
        options: [{ label: 'Piment', priceDelta: 2 }],
      },
    ]);
  });

  it('normalise suppléments et variante', () => {
    expect(
      normalizeSelectedSupplements([{ name: 'Bacon', price: 2 }]),
    ).toEqual([{ name: 'Bacon', price: 2 }]);
    expect(normalizeSelectedVariantLabel('  Large  ')).toBe('Large');
    expect(normalizeSelectedVariantLabel(null)).toBe('');
  });

  it('accepte title catalogue comme groupTitle', () => {
    expect(
      normalizeSelectedComplements([
        {
          title: 'Sauce',
          options: [{ label: 'Piment', priceDelta: 1 }],
        },
      ]),
    ).toEqual([
      {
        groupTitle: 'Sauce',
        options: [{ label: 'Piment', priceDelta: 1 }],
      },
    ]);
  });

  it('customizationSummaryLabel inclut la variante', () => {
    const label = customizationSummaryLabel(
      [{ groupTitle: 'Accomp.', options: [{ label: 'Riz', priceDelta: 0 }] }],
      [{ name: 'Extra', price: 1 }],
      'Medium',
    );
    expect(label).toContain('Variante : Medium');
    expect(label).toContain('Accomp.: Riz');
    expect(label).toContain('+ Extra');
  });
});
