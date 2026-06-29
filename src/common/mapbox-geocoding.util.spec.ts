import {
  pickMapboxGeocodingToken,
  probeMapboxGeocodingApi,
} from './mapbox-geocoding.util';

describe('mapbox-geocoding.util', () => {
  it('prefers pk token over sk for geocoding', () => {
    expect(
      pickMapboxGeocodingToken(['sk.secret', 'pk.public']),
    ).toBe('pk.public');
  });

  it('reports sk 403 with actionable hint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"message":"Forbidden"}',
    } as Response);

    const result = await probeMapboxGeocodingApi('sk.test');
    expect(result.ok).toBe(false);
    expect(result.details).toContain('MAPBOX_PUBLIC_ACCESS_TOKEN');

    fetchMock.mockRestore();
  });
});
