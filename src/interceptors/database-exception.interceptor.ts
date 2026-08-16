import {
  FieldConflictException,
  FieldErrors,
} from '@/exceptions/field.exceptions';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';

/** Matches the column list in the Postgres detail line: `Key (username)=(...)`. */
const UNIQUE_KEY_REGEX = /Key \(([^)]+)\)=/;

const toCamelCase = (column: string): string =>
  column.trim().replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase());

/**
 * Services pre-check uniqueness before inserting, but a concurrent request can
 * still slip between the check and the flush; this turns the resulting raw
 * database error into the same 409 shape the pre-checks produce, instead of a
 * 500 leaking the failed SQL statement.
 */
@Injectable()
export class DatabaseExceptionInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (!(error instanceof UniqueConstraintViolationException))
          return throwError(() => error);

        const columns = UNIQUE_KEY_REGEX.exec(error.message)?.[1];
        const fields: FieldErrors = Object.fromEntries(
          (columns?.split(',') ?? []).map((column) => {
            const field = toCamelCase(column);
            return [field, `This ${field} is already in use`];
          }),
        );

        return throwError(
          () =>
            new FieldConflictException(
              fields,
              columns ? undefined : 'Resource already exists',
            ),
        );
      }),
    );
  }
}
