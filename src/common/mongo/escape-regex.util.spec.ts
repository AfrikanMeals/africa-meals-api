import {
  buildCaseInsensitiveExactRegex,
  escapeMongoRegex,
} from './escape-regex.util';

describe('escape-regex.util', () => {
  it('échappe les métacaractères regex', () => {
    expect(escapeMongoRegex('a+b(c)?')).toBe('a\\+b\\(c\\)\\?');
  });

  it('construit un regex exact insensible à la casse', () => {
    const re = buildCaseInsensitiveExactRegex('Vendor@mail.com');
    expect(re.test('vendor@mail.com')).toBe(true);
    expect(re.test('vendor@mail.com.evil')).toBe(false);
  });
});
