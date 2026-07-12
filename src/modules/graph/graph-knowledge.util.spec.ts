import { deriveProductTagsFromText, zoneIdFromShippingRing } from './graph-knowledge.util';

describe('graph-knowledge.util', () => {
  it('derives dietary tags from FR/EN text', () => {
    expect(
      deriveProductTagsFromText(['Poulet halal piquant', 'sans gluten']),
    ).toEqual(expect.arrayContaining(['halal', 'spicy', 'gluten_free']));
    expect(deriveProductTagsFromText(['Vegan bowl'])).toContain('vegan');
  });

  it('builds stable zone ids from shipping rings', () => {
    expect(zoneIdFromShippingRing('s1', 0, 5)).toBe('s1:0.0-5.0');
  });
});
