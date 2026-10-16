import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toHttpError } from '../errors/http-error';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const body = toHttpError(exception);

    if (body.statusCode >= 500) {
      // Full details stay in the server log; the client only gets the generic message.
      this.logger.error(
        { err: exception, requestId: req.id, path: req.originalUrl },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (res.headersSent) return;
    // Body-parser errors fire before the request-id middleware, so mint an id here if needed.
    const requestId = req.id !== undefined ? String(req.id) : randomUUID();
    if (!res.getHeader('X-Request-Id')) res.setHeader('X-Request-Id', requestId);
    res.status(body.statusCode).json({
      ...body,
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
      requestId,
    });
  }
}
