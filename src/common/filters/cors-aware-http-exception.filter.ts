import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isBrowserCorsOriginAllowed } from '../cors/cors-options';

/** Réponses d’erreur avec en-têtes CORS (évite « CORS error » masquant un 403). */
@Catch()
export class CorsAwareHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    // GraphQL : laisser Apollo formater la réponse (évite ERR_HTTP_HEADERS_SENT).
    if (host.getType<string>() === 'graphql') {
      return;
    }

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    if (res.headersSent) {
      return;
    }

    const origin =
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (origin && isBrowserCorsOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    const isProd = process.env.NODE_ENV === 'production';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = {
      statusCode: status,
      message: 'internal_server_error',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        body = { statusCode: status, message: exceptionResponse };
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        body = {
          ...(exceptionResponse as Record<string, unknown>),
          statusCode: status,
        };
      }
    } else if (!isProd && exception instanceof Error) {
      body = {
        statusCode: status,
        message: exception.message || 'internal_server_error',
        error: exception.name,
      };
    }

    if (isProd && status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      body = {
        statusCode: status,
        message: 'internal_server_error',
      };
    }

    res.status(status).json(body);
  }
}
