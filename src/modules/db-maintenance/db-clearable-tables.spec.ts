import {
  buildOrphanTableKey,
  getKnownClearableCollections,
  isClearableTableKey,
  isValidOrphanCollectionName,
  parseOrphanTableKey,
  resolveClearableTable,
} from './db-clearable-tables';

describe('db-clearable-tables orphan helpers', () => {
  it('builds and parses orphan keys', () => {
    const key = buildOrphanTableKey('legacy_test_collection');
    expect(key).toBe('orphan:legacy_test_collection');
    expect(parseOrphanTableKey(key)).toBe('legacy_test_collection');
    expect(isClearableTableKey(key)).toBe(true);
  });

  it('rejects system and invalid collection names', () => {
    expect(isValidOrphanCollectionName('system.profile')).toBe(false);
    expect(isValidOrphanCollectionName('')).toBe(false);
    expect(isValidOrphanCollectionName('9bad')).toBe(false);
    expect(isClearableTableKey('orphan:system.foo')).toBe(false);
  });

  it('does not resolve orphan key for known catalogue collection', () => {
    const known = [...getKnownClearableCollections()][0];
    expect(known).toBeTruthy();
    const key = buildOrphanTableKey(known!);
    expect(resolveClearableTable(key)).toBeUndefined();
  });

  it('resolves synthetic orphan def', () => {
    const def = resolveClearableTable('orphan:my_legacy_data');
    expect(def?.category).toBe('orphan');
    expect(def?.collection).toBe('my_legacy_data');
  });
});
