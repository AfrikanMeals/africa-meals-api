import { sendGoogleMerchantExport } from './google-merchant-http.util';
import type { GoogleMerchantExportResult } from './google-merchant.types';
import type { NestHttpResponse } from '@common/http/http-response.util';

/** Reply Fastify sans setHeader — reproduit le 500 crawler GMC. */
function createFastifyReplyMock() {
  const headers: Record<string, string> = {};
  const reply: {
    sent: boolean;
    raw: { headersSent: boolean };
    statusCode: number;
    payload: unknown;
    contentType?: string;
    headers: Record<string, string>;
    header: (name: string, value: string) => typeof reply;
    code: (status: number) => typeof reply;
    status: (status: number) => typeof reply;
    type: (contentType: string) => typeof reply;
    send: (payload: unknown) => typeof reply;
  } = {
    sent: false,
    raw: { headersSent: false },
    statusCode: 200,
    payload: undefined,
    headers,
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
  // FastifyReply du SDK a trop de champs : mock structurel suffisant pour header/send.
  return reply as unknown as NestHttpResponse & typeof reply;
}

describe('sendGoogleMerchantExport', () => {
  const xmlResult: GoogleMerchantExportResult = {
    body: '<?xml version="1.0"?><rss version="2.0"/>',
    contentType: 'application/xml; charset=utf-8',
    filename: 'google-merchant-all-stores.xml',
  };

  it('sends XML inline for the Google crawler URL (no Content-Disposition)', () => {
    const reply = createFastifyReplyMock();
    sendGoogleMerchantExport(reply, xmlResult);
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBe(xmlResult.body);
    expect(reply.contentType).toBe(xmlResult.contentType);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['content-disposition']).toBeUndefined();
  });

  it('adds Content-Disposition when downloading (admin preview)', () => {
    const reply = createFastifyReplyMock();
    sendGoogleMerchantExport(reply, xmlResult, { asAttachment: true });
    expect(reply.headers['content-disposition']).toBe(
      `attachment; filename="${xmlResult.filename}"`,
    );
    expect(reply.payload).toBe(xmlResult.body);
  });

  it('does not throw when setHeader is missing (prod Fastify)', () => {
    const reply = createFastifyReplyMock();
    expect('setHeader' in reply).toBe(false);
    expect(() => sendGoogleMerchantExport(reply, xmlResult)).not.toThrow();
  });
});
