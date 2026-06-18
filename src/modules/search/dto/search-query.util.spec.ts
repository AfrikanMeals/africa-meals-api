import { SearchContent } from './search.dto';
import {
  normalizeSearchContentQuery,
  parseOptionalQueryNumber,
  trimOptionalQueryString,
} from './search-query.util';

describe('search-query.util', () => {
  it('normalise searchContent string', () => {
    expect(normalizeSearchContentQuery('products')).toEqual([
      SearchContent.PRODUCTS,
    ]);
    expect(normalizeSearchContentQuery('products,stores')).toEqual([
      SearchContent.PRODUCTS,
      SearchContent.STORES,
    ]);
  });

  it('normalise searchContent array (ValidationPipe / Express)', () => {
    expect(normalizeSearchContentQuery(['products'])).toEqual([
      SearchContent.PRODUCTS,
    ]);
    expect(normalizeSearchContentQuery(['products', 'stores'])).toEqual([
      SearchContent.PRODUCTS,
      SearchContent.STORES,
    ]);
  });

  it('parseOptionalQueryNumber accepts zero', () => {
    expect(parseOptionalQueryNumber('0')).toBe(0);
    expect(parseOptionalQueryNumber(0)).toBe(0);
    expect(parseOptionalQueryNumber('')).toBeUndefined();
  });

  it('trimOptionalQueryString ignores non-strings safely', () => {
    expect(trimOptionalQueryString('  foo  ')).toBe('foo');
    expect(trimOptionalQueryString(['x'])).toBe('x');
  });
});
