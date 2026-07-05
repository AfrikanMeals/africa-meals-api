import type { FastifyAdapter } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import querystring from 'node:querystring';
import { Readable } from 'stream';
import zlib from 'zlib';

/**
 * Parseurs JSON / urlencoded natifs Fastify (rawBody Stripe).
 * `express.json` via middie ne lit pas le flux Fastify → POST bloqués.
 *
 * Dio mobile envoie souvent `Content-Type: application/json` sans corps (ex. assign-self).
 */
export function registerFastifyBodyParsing(adapter: FastifyAdapter): void {
  const fastify = adapter.getInstance();
  const { bodyLimit } = fastify.initialConfig;
  const preserveRawBody = true;

  adapter.useBodyParser(
    'application/json',
    preserveRawBody,
    { bodyLimit },
    (req, body, done) => {
      if (isEmptyBodyBuffer(body)) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  adapter.useBodyParser(
    'application/x-www-form-urlencoded',
    preserveRawBody,
    { bodyLimit },
    (_req, body, done) => {
      done(null, querystring.parse(body.toString()));
    },
  );

  registerFastifyCompressedBodyHook(
    adapter.getInstance() as unknown as FastifyInstance,
  );
}

function isEmptyBodyBuffer(body: unknown): boolean {
  if (body == null) return true;
  if (!Buffer.isBuffer(body)) return false;
  return body.length === 0 || body.toString('utf8').trim().length === 0;
}

function registerFastifyCompressedBodyHook(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    const enc = String(request.headers['content-encoding'] || '').toLowerCase();
    if (!enc.includes('gzip') && !enc.includes('deflate')) {
      return payload;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks);
    const decoded = enc.includes('gzip')
      ? zlib.gunzipSync(raw)
      : zlib.inflateSync(raw);
    delete request.headers['content-encoding'];
    request.headers['content-length'] = String(decoded.length);
    return Readable.from(decoded);
  });
}
