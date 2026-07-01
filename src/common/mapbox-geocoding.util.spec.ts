import {
  probeMapboxGeocodingApi,
  resolveMapboxPublicAccessToken,
  resolveMapboxServerTokenFromEnv,
  sanitizeMapboxPublicAccessToken,
} from './mapbox-geocoding.util';

describe('mapbox-geocoding.util', () => {
  it('resolveMapboxServerTokenFromEnv reads MAPBOX_ACCESS_TOKEN only', () => {
    const prevPublic = process.env.MAPBOX_PUBLIC_ACCESS_TOKEN;
    const prevAccess = process.env.MAPBOX_ACCESS_TOKEN;
    process.env.MAPBOX_PUBLIC_ACCESS_TOKEN = 'pk.public-only';
    process.env.MAPBOX_ACCESS_TOKEN = 'sk.server-geocode';
    expect(resolveMapboxServerTokenFromEnv()).toBe('sk.server-geocode');
    process.env.MAPBOX_PUBLIC_ACCESS_TOKEN = prevPublic;
    process.env.MAPBOX_ACCESS_TOKEN = prevAccess;
  });

  it('sanitizeMapboxPublicAccessToken rejects sk and non-pk', () => {
    expect(sanitizeMapboxPublicAccessToken('pk.test')).toBe('pk.test');
    expect(sanitizeMapboxPublicAccessToken('sk.secret')).toBe('');
    expect(sanitizeMapboxPublicAccessToken('invalid')).toBe('');
  });

  it('resolveMapboxPublicAccessToken prefers secret manager pk', async () => {
    const secrets = {
      resolveString: jest.fn(async () => 'pk.from-db'),
    };
    const result = await resolveMapboxPublicAccessToken(
      secrets as never,
      undefined,
    );
    expect(result).toBe('pk.from-db');
  });

  it('reports sk 403 with actionable hint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"message":"Forbidden"}',
    } as Response);

    const result = await probeMapboxGeocodingApi('sk.test');
    expect(result.ok).toBe(false);
    expect(result.details).toContain('MAPBOX_ACCESS_TOKEN');

    fetchMock.mockRestore();
  });
});
