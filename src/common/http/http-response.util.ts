import type { FastifyReply } from 'fastify';
import type { Response } from 'express';
import type { ServerResponse } from 'http';

/** Réponse Express ou `reply.raw` Fastify (middie). */
export type MiddlewareResponse = Partial<Response> & Partial<ServerResponse>;

export type NestHttpResponse = MiddlewareResponse | FastifyReply;

export function isFastifyReply(res: unknown): res is FastifyReply {
  return (
    typeof res === 'object' &&
    res !== null &&
    typeof (res as FastifyReply).send === 'function' &&
    (typeof (res as FastifyReply).code === 'function' ||
      typeof (res as FastifyReply).status === 'function')
  );
}

function withFastifyStatus(reply: FastifyReply, statusCode: number): FastifyReply {
  if (typeof reply.code === 'function') {
    return reply.code(statusCode);
  }
  return reply.status(statusCode);
}

export function middlewareHeadersSent(res: MiddlewareResponse): boolean {
  return Boolean(res.headersSent);
}

export function nestHttpHeadersSent(res: NestHttpResponse): boolean {
  if (isFastifyReply(res)) {
    // FastifyReply.raw peut être absent dans les mocks ; optional chaining évite un throw.
    return Boolean(res.sent || res.raw?.headersSent);
  }
  return middlewareHeadersSent(res);
}

export function sendMiddlewareJson(
  res: MiddlewareResponse,
  statusCode: number,
  body: unknown,
  /** Headers additionnels (ex. Cache-Control: no-store sur erreurs médias). */
  extraHeaders?: Record<string, string>,
): void {
  if (middlewareHeadersSent(res)) return;
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      res.setHeader?.(name, value);
    }
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode).json(body);
    return;
  }
  const payload = JSON.stringify(body);
  if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      ...(extraHeaders ?? {}),
    });
    res.end(payload);
  }
}

export function sendMiddlewareStatus(
  res: MiddlewareResponse,
  statusCode: number,
): void {
  if (middlewareHeadersSent(res)) return;
  if (typeof res.sendStatus === 'function') {
    res.sendStatus(statusCode);
    return;
  }
  if (typeof res.status === 'function' && typeof res.end === 'function') {
    res.status(statusCode).end();
    return;
  }
  if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
    res.writeHead(statusCode);
    res.end();
  }
}

export function sendNestHttpJson(
  res: NestHttpResponse,
  statusCode: number,
  body: unknown,
): void {
  if (nestHttpHeadersSent(res)) return;
  if (isFastifyReply(res)) {
    void withFastifyStatus(res, statusCode).send(body);
    return;
  }
  sendMiddlewareJson(res, statusCode, body);
}

export function sendNestHttpText(
  res: NestHttpResponse,
  statusCode: number,
  body: string,
  contentType: string,
): void {
  // Délègue au chemin Fastify/Express unique (évite un 2e `setHeader` Express).
  sendNestHttpBody(res, statusCode, body, contentType);
}

/**
 * Envoie un corps texte ou binaire (XML GMC, XLSX).
 * FastifyReply n’a pas `setHeader` Express — d’où le 500 Google Merchant en prod.
 */
export function sendNestHttpBody(
  res: NestHttpResponse,
  statusCode: number,
  body: string | Buffer,
  contentType: string,
): void {
  if (nestHttpHeadersSent(res)) return;
  if (isFastifyReply(res)) {
    // Fastify : type() + send() ; pas de res.setHeader / res.send Express.
    void withFastifyStatus(res, statusCode).type(contentType).send(body);
    return;
  }
  if (typeof res.status === 'function' && typeof res.type === 'function') {
    res.status(statusCode).type(contentType).send(body);
    return;
  }
  if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
    res.writeHead(statusCode, { 'Content-Type': contentType });
    res.end(body);
  }
}

export function setNestHttpHeader(
  res: NestHttpResponse,
  name: string,
  value: string,
): void {
  if (isFastifyReply(res)) {
    // Fastify : `reply.header()`, pas `res.setHeader` (API Node/Express).
    if (typeof res.header === 'function') {
      res.header(name, value);
      return;
    }
    // Repli si Reply est partiellement mocké : ServerResponse Node sous `raw`.
    res.raw?.setHeader?.(name, value);
    return;
  }
  if (typeof res.setHeader === 'function') {
    res.setHeader(name, value);
    return;
  }
  // Fastify mal typé (send/status absents) : header() existe quand même sur Reply.
  const maybeHeader = (res as unknown as { header?: (n: string, v: string) => unknown })
    .header;
  if (typeof maybeHeader === 'function') {
    maybeHeader(name, value);
  }
}
