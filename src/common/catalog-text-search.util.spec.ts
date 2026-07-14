import {
  resolveCatalogTextSearchMode,
  toObjectIdStrings,
} from './catalog-text-search.util';

describe('catalog-text-search.util', () => {
  it('préfère ES quand des hits existent', () => {
    expect(
      resolveCatalogTextSearchMode({
        elasticsearchSearchEnabled: true,
        regexSearchEnabled: true,
        elasticsearchHitCount: 3,
        elasticsearchAttempted: true,
      }),
    ).toBe('elasticsearch');
  });

  it('fallback regex si ES aucun hit', () => {
    expect(
      resolveCatalogTextSearchMode({
        elasticsearchSearchEnabled: true,
        regexSearchEnabled: true,
        elasticsearchHitCount: 0,
        elasticsearchAttempted: true,
      }),
    ).toBe('regex');
  });

  it('vide si ES aucun hit et regex off', () => {
    expect(
      resolveCatalogTextSearchMode({
        elasticsearchSearchEnabled: true,
        regexSearchEnabled: false,
        elasticsearchHitCount: 0,
        elasticsearchAttempted: true,
      }),
    ).toBe('empty');
  });

  it('toObjectIdStrings filtre invalides', () => {
    expect(
      toObjectIdStrings([
        '507f1f77bcf86cd799439011',
        'short',
        '507f1f77bcf86cd799439011',
        'zzzzzzzzzzzzzzzzzzzzzzzz',
      ]),
    ).toEqual(['507f1f77bcf86cd799439011']);
  });
});
