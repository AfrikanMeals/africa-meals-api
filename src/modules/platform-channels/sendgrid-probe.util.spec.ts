import { probeSendgridApiKey } from './sendgrid-probe.util';

function mockFetch(
  responses: Record<string, { status: number; body?: unknown }>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(responses).find((key) => url.includes(key));
    const res = match ? responses[match] : { status: 404 };
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body ?? {},
    } as Response;
  }) as typeof fetch;
}

describe('probeSendgridApiKey', () => {
  it('accepts restricted keys with mail.send scope', async () => {
    const result = await probeSendgridApiKey(
      'SG.test',
      mockFetch({
        '/v3/scopes': {
          status: 200,
          body: { scopes: ['mail.send'] },
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain('mail.send');
  });

  it('rejects invalid keys with 401', async () => {
    const result = await probeSendgridApiKey(
      'SG.invalid',
      mockFetch({
        '/v3/scopes': {
          status: 401,
          body: {
            errors: [
              {
                message:
                  'The provided authorization grant is invalid, expired, or revoked',
              },
            ],
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.details).toContain('invalid');
  });

  it('falls back to user/account when scopes is not ok but account is', async () => {
    const result = await probeSendgridApiKey(
      'SG.test',
      mockFetch({
        '/v3/scopes': { status: 403 },
        '/v3/user/account': { status: 200, body: { type: 'free' } },
      }),
    );
    expect(result.ok).toBe(true);
  });
});
