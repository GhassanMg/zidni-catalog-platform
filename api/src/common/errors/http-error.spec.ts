import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toHttpError } from './http-error';

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test', meta });

describe('toHttpError', () => {
  it('keeps HttpException status, message and details', () => {
    expect(toHttpError(new NotFoundException('Category not found'))).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Category not found',
    });
    expect(
      toHttpError(new UnprocessableEntityException({ message: 'missing', details: { missingProductIds: ['x'] } })),
    ).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'missing',
      details: { missingProductIds: ['x'] },
    });
    expect(toHttpError(new BadRequestException(['a', 'b'])).message).toBe('a; b');
  });

  it.each([
    ['P2002', 409],
    ['P2025', 404],
    ['P2003', 409],
    ['P2000', 400],
    ['P2034', 409],
    ['P2024', 503],
    ['P9999', 500],
  ])('maps Prisma %s to %i', (code, status) => {
    expect(toHttpError(prismaError(code)).statusCode).toBe(status);
  });

  it('names the conflicting fields on unique violations', () => {
    expect(toHttpError(prismaError('P2002', { target: ['sku'] }))).toMatchObject({
      message: 'A record with the same sku already exists',
      details: { fields: ['sku'] },
    });
  });

  it('maps CHECK constraint violations to 400 without leaking SQL', () => {
    const error = new Prisma.PrismaClientUnknownRequestError(
      'new row for relation "products" violates check constraint "products_price_non_negative"',
      { clientVersion: 'test' },
    );
    expect(toHttpError(error)).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'A value violates a data integrity constraint',
    });
  });

  it('maps body-parser errors', () => {
    expect(toHttpError({ type: 'entity.parse.failed', status: 400 }).statusCode).toBe(400);
    expect(toHttpError({ type: 'entity.too.large', status: 413 }).statusCode).toBe(413);
  });

  it('hides unexpected errors behind a generic 500', () => {
    expect(toHttpError(new Error('secret connection string'))).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });
});
