# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev        # Hot-reload dev server (port 3000, or $PORT)
npm run start:debug      # Dev server with debugger attached
npm run start:prod       # Run the compiled build (dist/main)

# Build & lint
npm run build            # Compile via NestJS CLI
npm run build:migrations # Compile migrations only (tsconfig.migrations.json)
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier write

# Testing
npm test                 # Unit tests (*.spec.ts)
npm run test:watch       # Unit tests in watch mode
npm run test:cov         # Unit tests with coverage
npm run test:debug       # Unit tests with debugger attached, --runInBand
npm run test:e2e         # E2E tests (test/jest-e2e.json)

# Database
npm run migrate          # Run pending migrations (mikro-orm migration:up)
npm run migrate:down     # Roll back last migration
npm run makemigrations   # Generate new migration from entity changes

# CLI commands (management scripts)
npm run command -- <command-name>   # e.g. create-superuser

# Shared package
npm run update:shared    # Update @tokenizer/shared from GitHub
```

Commits go through husky + lint-staged (Prettier then ESLint on staged files). Note that lint-staged only matches `*.{js,ts}` and `*.{json,md,yml,yaml}` — `.mjs` files such as `eslint.config.mjs` are **not** formatted on commit, so run Prettier on them by hand.

## Architecture

**Framework stack:** NestJS 11, MikroORM 6 (PostgreSQL), Passport.js (session-based auth), Redis (three instances: sessions, cache, queues), BullMQ (background jobs), Firebase Storage (file uploads, image processing via sharp), Socket.IO (`@nestjs/websockets`), Zod (validation + serialization via nestjs-zod).

**Path aliases** (configured in `tsconfig.json`, mirrored in `jest.config.ts`):

- `@modules/*` → `src/modules/*`
- `@entities/*` → `src/entities/*`
- `@decorators/*` → `src/decorators/*`
- `@guards/*` → `src/guards/*`
- `@interceptors/*` → `src/interceptors/*`
- `@commands/*` → `src/modules/commands/*`
- `@utils/*` → `src/utils/*` (declared, but the directory does not exist yet)
- `@/*` → `src/*`
- `@test/*` → `test/*` (tests also get `@factories/*` → `test/factories/*`)

**Module structure** (`src/modules/`):

- `config/` — typed `ConfigService` wrapping `@nestjs/config`; all env vars are validated at startup via `config.schema.ts` (Zod schema). Always use `ConfigService.get()` instead of `process.env` inside the app.
- `sessions/` — session CRUD, local + Google OAuth2 (Passport strategies), `AuthenticatedGuard` for protected routes. See the Sessions conventions below.
- `users/` — user CRUD, password hashing (bcrypt), username uniqueness via slugify, Google account linking, avatar (relation to `File`). Usernames are set at creation and **not** editable through `update()`.
- `account-confirmations/` — email confirmation flow: single-use token mailed on signup, sets `User.confirmedAt`.
- `account-deletions/` — account deletion flow: single-use token mailed to confirm the (soft) deletion.
- `password-resets/` — token-based password reset flow with email delivery.
- `mail/` — `@nestjs-modules/mailer` with Handlebars templates in `templates/`. Mails are **queued** (BullMQ `MAIL_QUEUE`) and sent by `MailConsumer`. See the Mail conventions below.
- `files/` — file uploads to Firebase Storage: the `File` row is persisted as `Pending` before the transfer (crash-safe), images are processed with sharp, upload runs sync or async (`FILES_QUEUE` + `FilesConsumer`).
- `firebase/` — `FirebaseService` wrapping firebase-admin (Storage bucket access).
- `redis/` — three clients exposed as injectable services in `services/`: `RedisService` (core, session storage), `RedisQueueService` (BullMQ connection — always pass its `bullConnection` adapter, never the raw client), `RedisCacheService`. Each has its own host/port env vars.
- `game-core/` — game runtime exposed over REST (`GameRuntimeController`, POC) and WebSocket (`GameRuntimeGateway`, Socket.IO events `game:*`, payloads validated with the shared Zod schemas). `GameRuntimeService` holds the in-memory aggregate (`runtime/`: game-session, round, participant, pot, turn-state); `GameSessionsService` owns the persisted rows (`GameSession` + its pre-declared `GameParticipant` seats); `GameRoomsService` orchestrates both — lazy room opening (hydrating seats/balances from the DB), balance persistence on round resolution, host-only transitions, idle closure after 5 minutes. See `documentation.md` in the module.
- `commands/` — `nest-commander` CLI commands (e.g. `create-superuser`). Entry point is `src/cli.ts`.
- `health.controller.ts` — `GET /health` (liveness) and `GET /health/ready` (readiness: pings Postgres and the three Redis clients with a 1s timeout).

**Cross-cutting** (outside `src/modules/`):

- `src/main.ts` — bootstrap: `setupApp()` then `setupSwagger()`, listening on `process.env.PORT` (default `3000`). `PORT` is read straight from the environment, not through `ConfigService`, because it is needed before the app is up.
- `src/setup.ts` — everything global: `ZodValidationPipe`, the `HttpExceptionFilter` (logs `ZodSerializationException`), the interceptors, CORS (`https://tokenizer.fr` in production, reflect-origin otherwise, always `credentials: true`), `express-session`, and `passport.initialize()/session()`. In production it also sets `trust proxy` to `2` — TLS is terminated by Cloudflare and traffic reaches Node over two plain-HTTP hops (cloudflared → Traefik → Node), so express-session needs to trust `X-Forwarded-Proto` to emit the `secure` cookie.
- `src/swagger.ts` — Swagger UI at `GET /docs`, **development only** (it returns early on any other `NODE_ENV`).
- `src/guards/access.guard.ts` — `AccessGuard` ORs the access decorators from `src/decorators/access.decorators.ts`: `@Roles(...roles)` and `@AllowSelf(param)` (route param holding the target user uuid). An undecorated route is **denied by default**.
- `src/interceptors/` — `LoggingInterceptor` (request logging, see the Logging conventions below) and `DatabaseExceptionInterceptor` (maps DB errors, e.g. unique violations → 409). Both are registered globally in `setup.ts`, and the **order matters**: `DatabaseExceptionInterceptor` is registered last so its mapping runs first, letting `LoggingInterceptor` log the mapped 409 instead of a raw 500.
- `src/exceptions/field.exceptions.ts` — field-level exception helpers.
- `src/types/global.d.ts` — global utility types (see TypeScript conventions below). `src/types/express.d.ts` augments the express `SessionData`.

**Entities** (`src/entities/`):

- `User` — soft-delete via `deletedAt` (filter `notDeleted` applied by default), local + Google OAuth credentials, `role` (`UserRole` enum from shared), `avatar` (→ `File`), `confirmedAt` for email confirmation.
- `File` — Firebase Storage object metadata (unique bucket name/key pair, sha256 checksum, `FileStatus`), soft-delete via `notDeleted` filter.
- `tokens/` — abstract `Token` base class (single-use, expiring, stores `tokenHash`) with concrete `PasswordResetToken`, `AccountConfirmationToken` and `AccountDeletionToken`, each owning its table and `user` FK.
- `game/` — `GameSession` (owner `User`, `GameConfig` stored as plain JSONB, validated with the shared `gameConfigSchema` at the boundaries) and `GameParticipant` (one row per declared seat: `seat_index`, `role` HOST/PLAYER, balances, nullable `user` link, `claimed_by`/`claimed_at`).

**DTOs** use `nestjs-zod` (`createZodDto`) and pull their schemas from the `@tokenizer/shared` package (GitHub: `T0kenizer/shared`). Validation is applied globally via `ZodValidationPipe`; serialization via `ZodSerializerInterceptor`.

**Background jobs:** BullMQ is wired in `AppModule` via `BullModule.forRootAsync` using `RedisQueueService.bullConnection` (a node-redis adapter — required so BullMQ doesn't fall back to requiring ioredis). Queues: `MAIL_QUEUE` (`MailConsumer`) and `FILES_QUEUE` (`FilesConsumer`). Consumers extend `WorkerHost`; DB-touching consumers use `@CreateRequestContext()`.

**Shared package:** `@tokenizer/shared` is installed from a **GitHub branch**, pinned in `package.json` (`github:T0kenizer/shared#<branch>`). Constants (field lengths, banned usernames), enums (`UserRole`, `FileStatus`, …) and the Zod schemas behind the DTOs live there. Changing a contract means changing shared first, then `npm run update:shared` here. When a feature branch needs a matching shared branch, repin `package.json` — and when merging two such branches, the pin is a conflict git cannot see: pick the shared branch that contains **both** sides.

## Docker

Orchestration lives at the **monorepo root** (`../`), not in this package: `docker-compose.base.yml` (shared service definitions + network topology) is extended by `docker-compose.dev.yml`, `docker-compose.test.yml` and `docker-compose.yml` (prod). Use the `./compose` wrapper script instead of calling `docker compose` directly — it selects the right compose file and env file (`.env.development` / `.env.test` / `.env.production`, which must exist), and injects `UID`/`GID` and `DOCKER_SOCK`:

```bash
../compose dev up -d --build    # Full dev stack
../compose dev logs -f backend  # Any docker compose args work
../compose test up              # Test environment
../compose prod up -d           # Production
```

**Backend images** (`docker/`):

- `Dockerfile` — multi-stage production build: `builder` (compiles app + migrations) → `migrator` (runs `mikro-orm migration:up`, used as a one-shot container) → `runner` (non-root user, `npm run start:prod`).
- `Dockerfile.dev` — dev image; `src/` and `migrations/` are bind-mounted for hot reload, and the container runs `npm run migrate && npm run start:dev` on startup.

Both images set `ENV PORT=3000` and `EXPOSE ${PORT}`, so the exposed port follows the app's port from a single place.

**Dev stack ports** (bound to `127.0.0.1` only): backend `3000`, frontend `8080`, Storybook `6006`, Postgres `5432`, Redis core/queue/cache `6379`/`6380`/`6381`, Mailpit SMTP `1025` + web UI `8025` (catches all outgoing mail in dev).

**Network topology** (defined in the base file): `edge` (backend + frontend, reachable from the host/reverse proxy) and `internal` (`internal: true` — Postgres and the three Redis instances, unreachable from outside). The backend healthcheck hits `GET /health`; dependent services wait on `service_healthy`.

## Environment Variables

Every var below except `PORT` is declared in `src/modules/config/config.schema.ts` and validated at startup — the app **throws and refuses to boot** if a required one is missing or malformed.

| Variable                                                      | Description                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `NODE_ENV`                                                    | `development` (default) \| `production` \| `test` — gates CORS, cookies, Swagger |
| `PORT`                                                        | Optional, read from the raw environment in `main.ts`; defaults to `3000`         |
| `POSTGRES_HOST/PORT/USER/PASSWORD/DB`                         | PostgreSQL connection (`PORT` defaults to `5432`)                                |
| `REDIS_HOST/PORT`                                             | Redis (core, session store)                                                      |
| `REDIS_QUEUE_HOST/PORT`                                       | Redis (BullMQ queues)                                                            |
| `REDIS_CACHE_HOST/PORT`                                       | Redis (cache)                                                                    |
| `SMTP_HOST/FROM_DOMAIN/USER/PASSWORD`                         | All **optional** — mailing is off unless host and domain are both set            |
| `SMTP_PORT`                                                   | Defaults to `1025` (Mailpit in dev)                                              |
| `SECRET_KEY`                                                  | Session secret                                                                   |
| `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY/STORAGE_BUCKET` | Firebase Storage (`\n` in the key is unescaped automatically)                    |
| `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`                        | Google OAuth2                                                                    |
| `FRONTEND_URL`                                                | Used for post-OAuth redirect                                                     |

## Database / Migrations

Entities live in `src/entities/**/*.ts`; MikroORM scans them automatically via `autoLoadEntities: true` in `AppModule`. The standalone `mikro-orm.config.ts` (used by the CLI) reads from `process.env` directly.

After modifying an entity, run `npm run makemigrations` to generate a migration, then `npm run migrate` to apply it.

## TypeScript conventions

- File names must be in **kebab-case** (e.g. `game-runtime.service.ts` ✅ — `gameRuntimeService.ts` ❌).
- Use the global utility types `Optional<T>`, `Nullable<T>` and `Nullish<T>`, declared in `src/types/global.d.ts`, instead of writing `T | undefined`, `T | null` or `T | null | undefined` inline.
  - `foo: Optional<string>` ✅ — `foo: string | undefined` ❌
  - `bar: Nullable<Date>` ✅ — `bar: Date | null` ❌
  - `baz: Nullish<number>` ✅ — `baz: number | null | undefined` ❌

## Testing conventions

- **Unit tests** live in `*.spec.ts` files co-located with the file they test (e.g. `users.service.ts` → `users.service.spec.ts` in the same directory). **E2E tests** live in `test/` (`npm run test:e2e`, config in `test/jest-e2e.json`).
- `jest.setup.ts` is wired through `setupFilesAfterEnv`: it silences every `Logger` level and clears mock history before each test. Keep the two in sync — a `jest.setup.ts` that is not referenced from `jest.config.ts` fails silently, tests still green.
- `unbound-method` is disabled for spec files in `eslint.config.mjs`: passing `Logger.prototype.error` to an assertion is the point.
- The Jest config maps `@factories/*` to `test/factories/` and excludes modules/constants/entities/types from coverage.
- After changing `paths` in `tsconfig.json`, mirror them in `jest.config.ts` **and** `test/jest-e2e.json`.
- Run a single spec file: `npx jest src/modules/users/users.service.spec.ts`.

## Sessions

- Sessions are stored in Redis with `connect-redis` (prefix `sess:`), under the cookie `AUTH_COOKIE_NAME` (`GATEAU_SEC`). The cookie is `httpOnly` and `signed`; `secure` is production-only; `sameSite` is `'lax'` — **not** `'strict'`, so the cookie still rides the top-level redirect back from Google's OAuth screen.
- `express-session` runs with `rolling: true`, which on its own would extend _every_ session on _every_ request. `SessionsService.create()` opts each session into one of two regimes, driven by the `stayConnected` flag on the login DTO:
  - `stayConnected: true` → `session.rolling = true`, no absolute deadline: the session truly rolls, up to `EXTENDED_SESSION_TIMEOUT_MS` (30 days) of inactivity.
  - `stayConnected: false` (default) → `session.absoluteExpiresAt` is stamped at `now + SESSION_TIMEOUT_MS` (1 day), and `sessionExpirationMiddleware` (registered in `setup.ts`, right after `session()`) rewrites `cookie.maxAge` to the remaining time on every request. That is what stops `rolling` from renewing a session that was never meant to persist.
- The flag is named `stayConnected` everywhere — DTO, service, `SessionData`. It used to be `rememberMe`; the name lives in `@tokenizer/shared`, so renaming it again means changing shared first.

## Mail

- `MailService` splits every mail in two: `sendX()` only enqueues a job, `deliverX()` is what the consumer calls to talk to SMTP. Never call `deliverX()` from application code — it would block the request on SMTP and lose the retry.
- Only the **domain** is configuration (`SMTP_FROM_DOMAIN`); the mailboxes are the `Sender` enum in `mail.types.ts`, composed by `sender()`, which is typed against it so a mail cannot invent an address in passing. Adding one is a single enum member — never an env var for a full sender address. `DEFAULT_SENDER` (`Sender.Noreply`) is the transport's `from` default.
- Mailing is an **optional feature**: `SMTP_HOST` and `SMTP_FROM_DOMAIN` are optional in the config schema, the mailer falls back to `jsonTransport` when either is missing, and `MailService.enqueue` drops the job when `isMailConfigured()` is false. An instance with no SMTP settings keeps serving requests — but the account confirmation and password reset flows go nowhere, which is why `onModuleInit` says so at `warn` on every boot.
- Templates are Handlebars files under `src/modules/mail/templates`, wrapped by `partials/base.hbs`. They reach `dist` through the `assets` entry of `nest-cli.json` — a new template needs no config change, but a new template _directory_ does.
- `MailConsumer` drops jobs whose token has already expired.

## Logging

- `LoggingInterceptor` logs a 4xx at `warn` and a 5xx at `error`: a client sending a bad request is not a server failure, and burying real failures under 401s and 404s makes the error level useless. Only a 5xx also logs the error object.
- In development (the `debug` flag it is constructed with in `setup.ts`) a 5xx is re-thrown with `error.stack` in the response body. Production returns the bare status.
