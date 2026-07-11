import { resolveHereApiKey } from './here-routing.util';

describe('here-routing.util', () => {
  const prevEnv = process.env.HERE_API_KEY;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.HERE_API_KEY;
    else process.env.HERE_API_KEY = prevEnv;
  });

  it('resolveHereApiKey prefers secret manager over env', async () => {
    process.env.HERE_API_KEY = 'from-env';
    const secrets = {
      resolveString: jest.fn(async () => 'from-db'),
    };
    const result = await resolveHereApiKey(secrets as never, undefined);
    expect(result).toBe('from-db');
    expect(secrets.resolveString).toHaveBeenCalledWith('api', 'HERE_API_KEY');
  });

  it('resolveHereApiKey falls back to env and strips quotes', async () => {
    process.env.HERE_API_KEY = '"here-key-xyz"';
    const secrets = {
      resolveString: jest.fn(async () => ''),
    };
    const result = await resolveHereApiKey(secrets as never, undefined);
    expect(result).toBe('here-key-xyz');
  });

  it('resolveHereApiKey returns empty when unset', async () => {
    delete process.env.HERE_API_KEY;
    const secrets = {
      resolveString: jest.fn(async () => ''),
    };
    const result = await resolveHereApiKey(secrets as never, undefined);
    expect(result).toBe('');
  });
});
