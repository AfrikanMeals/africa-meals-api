import { resolveTomTomApiKey } from './tomtom-api-key.util';

describe('tomtom-api-key.util', () => {
  const prevRouting = process.env.TOMTOM_ROUTING_API_KEY;
  const prevGeocode = process.env.TOMTOM_GEOCODING_API_KEY;
  const prevGeneric = process.env.TOMTOM_API_KEY;

  afterEach(() => {
    const restore = (name: string, prev: string | undefined) => {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    };
    restore('TOMTOM_ROUTING_API_KEY', prevRouting);
    restore('TOMTOM_GEOCODING_API_KEY', prevGeocode);
    restore('TOMTOM_API_KEY', prevGeneric);
  });

  it('prefers secret manager routing key', async () => {
    process.env.TOMTOM_GEOCODING_API_KEY = 'env-geocode';
    const secrets = {
      resolveString: jest.fn(async (_s: string, name: string) =>
        name === 'TOMTOM_ROUTING_API_KEY' ? 'db-routing' : '',
      ),
    };
    expect(await resolveTomTomApiKey(secrets as never)).toBe('db-routing');
  });

  it('falls back to geocoding then generic env', async () => {
    delete process.env.TOMTOM_ROUTING_API_KEY;
    process.env.TOMTOM_GEOCODING_API_KEY = '"geo-key"';
    delete process.env.TOMTOM_API_KEY;
    const secrets = {
      resolveString: jest.fn(async () => ''),
    };
    expect(await resolveTomTomApiKey(secrets as never)).toBe('geo-key');
  });
});
