import {
  sendNestHttpBody,
  setNestHttpHeader,
  type NestHttpResponse,
} from './http-response.util';

/** Reply Fastify minimal : send/code/header/type, sans setHeader (cas prod). */
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

describe('http-response.util Fastify', () => {
  it('sets headers without res.setHeader (FastifyReply)', () => {
    const reply = createFastifyReplyMock();
    setNestHttpHeader(reply, 'Cache-Control', 'no-store');
    expect(reply.headers['cache-control']).toBe('no-store');
  });

  it('sends XML body with content-type on FastifyReply', () => {
    const reply = createFastifyReplyMock();
    const xml = '<?xml version="1.0"?><rss/>';
    sendNestHttpBody(reply, 200, xml, 'application/xml; charset=utf-8');
    expect(reply.statusCode).toBe(200);
    expect(reply.contentType).toBe('application/xml; charset=utf-8');
    expect(reply.payload).toBe(xml);
    expect(reply.sent).toBe(true);
  });

  it('sends Buffer body (xlsx) on FastifyReply', () => {
    const reply = createFastifyReplyMock();
    const body = Buffer.from('xlsx-bytes');
    sendNestHttpBody(
      reply,
      200,
      body,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(reply.payload).toBe(body);
    expect(reply.sent).toBe(true);
  });
});
