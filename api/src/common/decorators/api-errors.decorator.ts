import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

const DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed or the request is malformed',
  401: 'Missing, invalid, expired or revoked credentials',
  403: 'Authenticated, but lacking the required permission',
  404: 'Resource not found',
  409: 'Conflicts with existing data (unique value, concurrent change, ...)',
  413: 'Request body too large',
  422: 'Referenced resources do not exist',
  429: 'Too many requests',
};

/** Documents the shared error envelope for the given status codes. */
export function ApiErrors(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, description: DESCRIPTIONS[status], type: ErrorResponseDto }),
    ),
  );
}
