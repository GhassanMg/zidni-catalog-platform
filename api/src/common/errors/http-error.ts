import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STATUS_CODES } from 'node:http';

/** The single error shape returned by every endpoint (and surfaced verbatim to MCP agents). */
export interface HttpErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

function build(statusCode: number, message: string, details?: unknown): HttpErrorBody {
  return {
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Error',
    message,
    ...(details !== undefined ? { details } : {}),
  };
}

/** Normalises any thrown value into an HTTP status + safe, client-facing message. */
export function toHttpError(exception: unknown): HttpErrorBody {
  if (exception instanceof HttpException) return fromHttpException(exception);
  if (exception instanceof Prisma.PrismaClientKnownRequestError) return fromPrismaError(exception);
  if (exception instanceof Prisma.PrismaClientInitializationError) {
    return build(503, 'Database is unavailable, please retry later');
  }
  if (
    exception instanceof Prisma.PrismaClientUnknownRequestError &&
    /check constraint/i.test(exception.message)
  ) {
    return build(400, 'A value violates a data integrity constraint');
  }
  if (isBodyParserError(exception)) {
    return exception.type === 'entity.too.large'
      ? build(413, 'Request body is too large')
      : build(400, 'Malformed JSON request body');
  }
  return build(500, 'Internal server error');
}

function fromHttpException(exception: HttpException): HttpErrorBody {
  const status = exception.getStatus();
  const response = exception.getResponse();
  if (typeof response === 'string') return build(status, response);

  const body = response as { message?: unknown; details?: unknown };
  const message = Array.isArray(body.message)
    ? body.message.join('; ')
    : typeof body.message === 'string'
      ? body.message
      : exception.message;
  return build(status, message, body.details);
}

function fromPrismaError(error: Prisma.PrismaClientKnownRequestError): HttpErrorBody {
  switch (error.code) {
    case 'P2002': {
      const target = error.meta?.target;
      const fields = Array.isArray(target)
        ? target.map(String)
        : typeof target === 'string'
          ? [target]
          : [];
      return build(
        409,
        fields.length
          ? `A record with the same ${fields.join(', ')} already exists`
          : 'A record with the same unique value already exists',
        { fields },
      );
    }
    case 'P2025':
      return build(404, 'Resource not found');
    case 'P2003':
      return build(409, 'The operation conflicts with a related record', {
        field: error.meta?.field_name,
      });
    case 'P2000':
      return build(400, 'A value is too long for its field', { field: error.meta?.column_name });
    case 'P2034':
      return build(409, 'The record was modified concurrently, please retry');
    case 'P2024':
      return build(503, 'Database is busy, please retry later');
    default:
      return build(500, 'Internal server error');
  }
}

interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as BodyParserError).type === 'string' &&
    typeof (error as BodyParserError).status === 'number' &&
    (error as BodyParserError).type.startsWith('entity.')
  );
}
