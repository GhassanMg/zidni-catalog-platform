import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';
import { AuditFailureRecorder } from './audit-failure.recorder';

/**
 * Covers failures raised after the guards: validation pipes, business rules and database
 * errors. Guard rejections (401/403) are recorded by the guards themselves because they
 * run before interceptors.
 */
@Injectable()
export class AuditFailureInterceptor implements NestInterceptor {
  constructor(private readonly recorder: AuditFailureRecorder) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        from(this.recorder.record(context, error)).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }
}
