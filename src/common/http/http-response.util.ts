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
    return Boolean(res.sent || res.raw.headersSent);
  }
  return middlewareHeadersSent(res);
}

export function sendMiddlewareJson(
  res: MiddlewareResponse,
  statusCode: number,
  body: unknown,
): void {
  if (middlewareHeadersSent(res)) return;
  if (typeof res.status === 'function') {
    res.status(statusCode).json(body);
    return;
  }
  const payload = JSON.stringify(body);
  if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
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
  if (nestHttpHeadersSent(res)) return;
  if (isFastifyReply(res)) {
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
    res.header(name, value);
    return;
  }
  res.setHeader?.(name, value);
}
