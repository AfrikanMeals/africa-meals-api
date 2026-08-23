import {
  readGoogleMerchantBasicAuthCredentials,
  verifyGoogleMerchantBasicAuthHeader,
  checkGoogleMerchantBasicAuth,
  assertGoogleMerchantBasicAuth,
} from './google-merchant-basic-auth.util';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { NestHttpResponse } from '@common/http/http-response.util';

describe('google-merchant-basic-auth.util', () => {
  const config = {
    get: (key: string) => {
      if (key === 'GOOGLE_MERCHANT_BASIC_AUTH_USER') return 'merchant';
      if (key === 'GOOGLE_MERCHANT_BASIC_AUTH_PASSWORD') return 'secret-pass';
      return undefined;
    },
  } as ConfigService;

  it('reads credentials from config', () => {
    expect(readGoogleMerchantBasicAuthCredentials(config)).toEqual({
      user: 'merchant',
      password: 'secret-pass',
    });
  });

  it('validates Basic auth header', () => {
    const token = Buffer.from('merchant:secret-pass').toString('base64');
    expect(
      verifyGoogleMerchantBasicAuthHeader(
        `Basic ${token}`,
        'merchant',
        'secret-pass',
      ),
    ).toBe(true);
    expect(
      verifyGoogleMerchantBasicAuthHeader(
        `Basic ${token}`,
        'merchant',
        'wrong',
      ),
    ).toBe(false);
  });

  it('reports auth failure reasons', () => {
    const req = { headers: {} } as Request;
    expect(checkGoogleMerchantBasicAuth(req, config)).toEqual({
      ok: false,
      status: 401,
      reason: 'missing_authorization_header',
      body: 'Unauthorized',
    });

    const badScheme = {
      headers: { authorization: 'Bearer token' },
    } as Request;
    expect(checkGoogleMerchantBasicAuth(badScheme, config)).toEqual({
      ok: false,
      status: 401,
      reason: 'invalid_authorization_scheme',
      body: 'Unauthorized',
    });

    const token = Buffer.from('merchant:secret-pass').toString('base64');
    const okReq = {
      headers: { authorization: `Basic ${token}` },
    } as Request;
    expect(checkGoogleMerchantBasicAuth(okReq, config)).toEqual({
      ok: true,
      user: 'merchant',
    });
  });

  it('sends 401 + WWW-Authenticate on FastifyReply without setHeader', () => {
    const headers: Record<string, string> = {};
    const reply = {
      sent: false,
      raw: { headersSent: false },
      statusCode: 200,
      payload: undefined as unknown,
      contentType: undefined as string | undefined,
      header(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return reply;
      },
      code(status: number) {
        reply.statusCode = status;
        return reply;
      },
      status(status: number) {
        reply.statusCode = status;
        return reply;
      },
      type(contentType: string) {
        reply.contentType = contentType;
        headers['content-type'] = contentType;
        return reply;
      },
      send(payload: unknown) {
        reply.payload = payload;
        reply.sent = true;
        reply.raw.headersSent = true;
        return reply;
      },
    };
    const req = { headers: {} } as Request;
    // Fastify n’expose pas setHeader : le 401 crawler ne doit plus devenir un 500.
    const ok = assertGoogleMerchantBasicAuth(
      req,
      reply as unknown as NestHttpResponse,
      config,
    );
    expect(ok).toBe(false);
    expect(reply.statusCode).toBe(401);
    expect(headers['www-authenticate']).toContain('Basic realm=');
    expect(reply.payload).toBe('Unauthorized');
    expect(reply.sent).toBe(true);
  });
});
