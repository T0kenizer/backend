import { SkipLogging } from '@decorators/logging.decorators';
import { LoggingInterceptor } from '@interceptors/logging.interceptor';
import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';

describe(LoggingInterceptor.name, () => {
  class LoggedController {
    handle() {}
  }

  @SkipLogging()
  class SilentController {
    handle() {}
  }

  const context = (controller: typeof LoggedController = LoggedController) =>
    ({
      getHandler: () => controller.prototype.handle,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/users/42',
          user: { email: 'user@tokenizer.fr' },
        }),
      }),
    }) as unknown as ExecutionContext;

  const handler = (error?: unknown): CallHandler =>
    ({
      handle: () => (error ? throwError(() => error) : of('ok')),
    }) as CallHandler;

  const run = (
    error?: unknown,
    debug = false,
    controller?: typeof LoggedController,
  ) =>
    firstValueFrom(
      new LoggingInterceptor(debug).intercept(
        context(controller),
        handler(error),
      ) as ReturnType<CallHandler['handle']>,
    );

  it('should log a 4xx as a warning, not an error', async () => {
    await expect(run(new ForbiddenException())).rejects.toThrow();

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('403'),
    );
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('should log a 5xx as an error', async () => {
    await expect(run(new InternalServerErrorException())).rejects.toThrow();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('500'),
    );
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('should treat an error carrying no status as a 5xx', async () => {
    await expect(run(new Error('boom'))).rejects.toThrow('boom');

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('500'),
    );
  });

  it('should attach the stack to the response in debug mode', async () => {
    await expect(
      run(new InternalServerErrorException(), true),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('should stay quiet on a fast successful request', async () => {
    await expect(run()).resolves.toBe('ok');

    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('should log a successful request in debug mode', async () => {
    await expect(run(undefined, true)).resolves.toBe('ok');

    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('user@tokenizer.fr'),
    );
  });

  it('should stay quiet on a controller marked @SkipLogging', async () => {
    await expect(run(undefined, true, SilentController)).resolves.toBe('ok');
    await expect(
      run(new InternalServerErrorException(), true, SilentController),
    ).rejects.toThrow();

    expect(Logger.prototype.log).not.toHaveBeenCalled();
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });
});
