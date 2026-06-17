import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

/** Masque les détails 5xx en production (L-03). */
@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
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

    response.status(status).json(body);
  }
}
