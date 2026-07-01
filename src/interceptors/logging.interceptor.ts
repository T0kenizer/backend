import { User } from '@entities/user.entity';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { catchError, Observable, tap, throwError } from 'rxjs';

interface HttpError extends Error {
  status?: number;
  getStatus?(): number;
}

const MIN_LOGGING_DURATION_MS = 250;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> | Promise<Observable<unknown>> {
    const request: Request = context.switchToHttp().getRequest();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        if (duration < MIN_LOGGING_DURATION_MS) return;
        const user: Optional<User> = request.user;

        this.logger.log(
          `${request.method} ${request.originalUrl} ${duration}ms - requested by ${user?.email || 'ANONYMOUS'}`,
        );
      }),
      catchError((error: HttpError) => {
        const duration = Date.now() - start;
        const user: Optional<User> = request.user;
        const status = error.getStatus?.() || error.status || 500;

        this.logger.error(
          `${request.method} ${request.originalUrl} ${duration}ms - ${status} - requested by ${user?.email || 'ANONYMOUS'}`,
        );
        if (status >= 500) this.logger.error(error);
        return throwError(() => error);
      }),
    );
  }
}
