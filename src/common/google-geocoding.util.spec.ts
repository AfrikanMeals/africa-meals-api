import {
  googleForwardGeocode,
  googleReverseGeocode,
} from './google-geocoding.util';

describe('google-geocoding.util', () => {
  it('googleForwardGeocode returns empty without key or short query', async () => {
    expect(await googleForwardGeocode('ab', '')).toEqual([]);
    expect(await googleForwardGeocode('ab', 'key')).toEqual([]);
  });

  it('googleReverseGeocode returns null without key', async () => {
    expect(await googleReverseGeocode(45, -73, '')).toBeNull();
  });
});
