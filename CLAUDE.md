# Backend guidelines

## TypeScript conventions

- Use the global utility types `Optional<T>`, `Nullable<T>` and `Nullish<T>`, declared in `src/types/global.d.ts`, instead of writing `T | undefined`, `T | null` or `T | null | undefined` inline.
  - `foo: Optional<string>` ✅ — `foo: string | undefined` ❌
  - `bar: Nullable<Date>` ✅ — `bar: Date | null` ❌
  - `baz: Nullish<number>` ✅ — `baz: number | null | undefined` ❌

## Mail

- `MailService` splits every mail in two: `sendX()` only enqueues a job, `deliverX()` is what the consumer calls to talk to SMTP. Never call `deliverX()` from application code — it would block the request on SMTP and lose the retry.
- Only the **domain** is configuration (`SMTP_FROM_DOMAIN`); the mailboxes are the `Sender` enum in `mail.types.ts`, composed by `sender()`, which is typed against it so a mail cannot invent an address in passing. Adding one is a single enum member — never an env var for a full sender address. `DEFAULT_SENDER` (`Sender.Noreply`) is the transport's `from` default.
- Mailing is an **optional feature**: `SMTP_HOST` and `SMTP_FROM_DOMAIN` are optional in the config schema, and `MailService.enqueue` drops the job when `isMailConfigured()` is false. An instance with no SMTP settings keeps serving requests — but the account confirmation and password reset flows go nowhere, which is why `onModuleInit` says so at `warn` on every boot.
- Templates are Handlebars files under `src/modules/mail/templates`, wrapped by `partials/base.hbs`. They reach `dist` through the `assets` entry of `nest-cli.json`.
- `MailConsumer` drops jobs whose token has already expired.

## Logging

- `LoggingInterceptor` logs a 4xx at `warn` and a 5xx at `error`: a client sending a bad request is not a server failure, and burying real failures under 401s and 404s makes the error level useless.

## Tests

- `npm test` runs the unit suites; `jest.setup.ts` silences `Logger` and clears mock history before each test.
- After changing `paths` in `tsconfig.json`, mirror them in `jest.config.ts` and `test/jest-e2e.json`.
