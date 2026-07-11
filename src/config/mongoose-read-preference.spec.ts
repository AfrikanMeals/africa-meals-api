import { resolveMongoReadPreference } from './mongoose-connection.factory';

describe('resolveMongoReadPreference', () => {
  it('defaults to secondaryPreferred', () => {
    expect(resolveMongoReadPreference(undefined)).toBe('secondaryPreferred');
    expect(resolveMongoReadPreference('')).toBe('secondaryPreferred');
    expect(resolveMongoReadPreference('bogus')).toBe('secondaryPreferred');
  });

  it('accepts driver read preference names', () => {
    expect(resolveMongoReadPreference('primary')).toBe('primary');
    expect(resolveMongoReadPreference('primaryPreferred')).toBe(
      'primaryPreferred',
    );
    expect(resolveMongoReadPreference('secondary')).toBe('secondary');
    expect(resolveMongoReadPreference('secondary_preferred')).toBe(
      'secondaryPreferred',
    );
    expect(resolveMongoReadPreference('nearest')).toBe('nearest');
  });
});
