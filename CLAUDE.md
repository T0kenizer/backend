# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev        # Hot-reload dev server (port 3000)
npm run start:debug      # Dev server with debugger attached

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

## Architecture

**Framework stack:** NestJS 11, MikroORM 6 (PostgreSQL), Passport.js (session-based auth), Redis (three instances: sessions, cache, queues), BullMQ (background jobs), Firebase Storage (file uploads, image processing via sharp), Socket.IO (`@nestjs/websockets`), Zod (validation + serialization via nestjs-zod).

**Path aliases** (configured in `tsconfig.json`, mirrored in `jest.config.ts`):

- `@modules/*` → `src/modules/*`
- `@entities/*` → `src/entities/*`
- `@decorators/*` → `src/decorators/*`
- `@guards/*` → `src/guards/*`
- `@interceptors/*` → `src/interceptors/*`
- `@commands/*` → `src/modules/commands/*`
- `@utils/*` → `src/utils/*`
- `@/*` → `src/*`
- `@test/*` → `test/*` (tests also get `@factories/*` → `test/factories/*`)

**Module structure** (`src/modules/`):

- `config/` — typed `ConfigService` wrapping `@nestjs/config`; all env vars are validated at startup via `config.schema.ts` (Zod schema). Always use `ConfigService.get()` instead of `process.env` inside the app.
- `sessions/` — session CRUD, local + Google OAuth2 (Passport strategies), `AuthenticatedGuard` for protected routes.
- `users/` — user CRUD, password hashing (bcrypt), username uniqueness via slugify, Google account linking, avatar (relation to `File`).
- `account-confirmations/` — email confirmation flow: single-use token mailed on signup, sets `User.confirmedAt`.
- `account-deletions/` — account deletion flow: single-use token mailed to confirm the (soft) deletion.
- `password-resets/` — token-based password reset flow with email delivery.
- `mail/` — `@nestjs-modules/mailer` with Handlebars templates in `templates/`. Mails are **queued** (BullMQ `MAIL_QUEUE`) and sent by `MailConsumer`, which skips jobs that outlived their token's TTL.
- `files/` — file uploads to Firebase Storage: the `File` row is persisted as `Pending` before the transfer (crash-safe), images are processed with sharp, upload runs sync or async (`FILES_QUEUE` + `FilesConsumer`).
- `firebase/` — `FirebaseService` wrapping firebase-admin (Storage bucket access).
- `redis/` — three clients exposed as injectable services in `services/`: `RedisService` (core, session storage), `RedisQueueService` (BullMQ connection — always pass its `bullConnection` adapter, never the raw client), `RedisCacheService`. Each has its own host/port env vars.
- `game-core/` — in-memory game runtime exposed over REST (`GameRuntimeController`, POC) and WebSocket (`GameRuntimeGateway`, Socket.IO events `game:*`). `GameRuntimeService` holds the aggregate (`runtime/`: game-session, round, participant, pot, turn-state); config objects in `config/` (action defs, economy/turn/end policies) are (de)serialized via `ConfigManager`. Database persistence is planned but not wired yet.
- `commands/` — `nest-commander` CLI commands (e.g. `create-superuser`). Entry point is `src/cli.ts`.
- `health.controller.ts` — `GET /health` (liveness) and `GET /health/ready` (readiness: pings Postgres and the three Redis clients with a 1s timeout).

**Cross-cutting** (outside `src/modules/`):

- `src/guards/access.guard.ts` — `AccessGuard` ORs the access decorators from `src/decorators/access.decorators.ts`: `@Roles(...roles)` and `@AllowSelf(param)` (route param holding the target user uuid). An undecorated route is **denied by default**.
- `src/interceptors/` — `LoggingInterceptor` (request logging) and `DatabaseExceptionInterceptor` (maps DB errors, e.g. unique violations → 409); both registered globally in `setup.ts`.
- `src/exceptions/field.exceptions.ts` — field-level exception helpers.
- `src/types/global.d.ts` — global utility types (see TypeScript conventions below).

**Entities** (`src/entities/`):

- `User` — soft-delete via `deletedAt` (filter `notDeleted` applied by default), local + Google OAuth credentials, `role` (`UserRole` enum from shared), `avatar` (→ `File`), `confirmedAt` for email confirmation.
- `File` — Firebase Storage object metadata (unique bucket name/key pair, sha256 checksum, `FileStatus`), soft-delete via `notDeleted` filter.
- `tokens/` — abstract `Token` base class (single-use, expiring, stores `tokenHash`) with concrete `PasswordResetToken`, `AccountConfirmationToken` and `AccountDeletionToken`, each owning its table and `user` FK.
- `game/` — `GameSession` (owner `User`, config stored as JSONB and deserialized through `ConfigManager`) and `GameParticipant`.

**DTOs** use `nestjs-zod` (`createZodDto`) and pull their schemas from the `@tokenizer/shared` package (GitHub: `T0kenizer/shared`). Validation is applied globally via `ZodValidationPipe`; serialization via `ZodSerializerInterceptor`.

**Session auth flow:** Sessions are stored in Redis with `connect-redis`. Cookie is `httpOnly`/signed; `secure` + `sameSite: strict` are enabled in production only. `passport.session()` is wired globally in `setup.ts`.

**Background jobs:** BullMQ is wired in `AppModule` via `BullModule.forRootAsync` using `RedisQueueService.bullConnection` (a node-redis adapter — required so BullMQ doesn't fall back to requiring ioredis). Queues: `MAIL_QUEUE` (`MailConsumer`) and `FILES_QUEUE` (`FilesConsumer`). Consumers extend `WorkerHost`; DB-touching consumers use `@CreateRequestContext()`.

**Shared package:** `@tokenizer/shared` is installed from a GitHub branch. Update it with `npm run update:shared`. Constants (field lengths, banned usernames), enums (`UserRole`, `FileStatus`, …) and Zod schemas for DTOs live there.

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

**Dev stack ports** (bound to `127.0.0.1` only): backend `3000`, frontend `8080`, Storybook `6006`, Postgres `5432`, Redis core/queue/cache `6379`/`6380`/`6381`, Mailpit SMTP `1025` + web UI `8025` (catches all outgoing mail in dev).

**Network topology** (defined in the base file): `edge` (backend + frontend, reachable from the host/reverse proxy) and `internal` (`internal: true` — Postgres and the three Redis instances, unreachable from outside). The backend healthcheck hits `GET /health`; dependent services wait on `service_healthy`.

## Environment Variables

All required vars are defined in `src/modules/config/config.schema.ts`. The app throws at startup if any are missing:

| Variable                                                      | Description                                               |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `POSTGRES_HOST/PORT/USER/PASSWORD/DB`                          | PostgreSQL connection                                      |
| `REDIS_HOST/PORT`                                              | Redis (core, session store)                                |
| `REDIS_QUEUE_HOST/PORT`                                        | Redis (BullMQ queues)                                      |
| `REDIS_CACHE_HOST/PORT`                                        | Redis (cache)                                              |
| `SMTP_HOST/PORT/FROM` (optional `SMTP_USER/PASSWORD`)          | Mail (dev: Mailpit on port 1025)                           |
| `SECRET_KEY`                                                   | Session secret                                             |
| `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY/STORAGE_BUCKET`  | Firebase Storage (`\n` in the key is unescaped automatically) |
| `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`                         | Google OAuth2                                              |
| `FRONTEND_URL`                                                 | Used for post-OAuth redirect                               |

## Database / Migrations

Entities live in `src/entities/**/*.ts`; MikroORM scans them automatically via `autoLoadEntities: true` in `AppModule`. The standalone `mikro-orm.config.ts` (used by the CLI) reads from `process.env` directly.

After modifying an entity, run `npm run makemigrations` to generate a migration, then `npm run migrate` to apply it.

## Testing conventions

- **Unit tests** live in `*.spec.ts` files co-located with the file they test (e.g. `users.service.ts` → `users.service.spec.ts` in the same directory).
- **E2E tests** live in `test/` (run with `npm run test:e2e`, config in `test/jest-e2e.json`).

The Jest config maps `@factories/*` to `test/factories/` for test data factories, loads `jest.setup.ts`, and excludes modules/constants/entities/types from coverage. Run a single spec file:

```bash
npx jest src/modules/users/users.service.spec.ts
```

## TypeScript conventions

- File names must be in **kebab-case** (e.g. `game-runtime.service.ts` ✅ — `gameRuntimeService.ts` ❌).
- Use the global utility types `Optional<T>`, `Nullable<T>` and `Nullish<T>`, declared in `src/types/global.d.ts`, instead of writing `T | undefined`, `T | null` or `T | null | undefined` inline.
  - `foo: Optional<string>` ✅ — `foo: string | undefined` ❌
  - `bar: Nullable<Date>` ✅ — `bar: Date | null` ❌
  - `baz: Nullish<number>` ✅ — `baz: number | null | undefined` ❌
