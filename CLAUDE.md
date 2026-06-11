# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev        # Hot-reload dev server (port 3000)
npm run start:debug      # Dev server with debugger attached

# Build & lint
npm run build            # Compile via NestJS CLI
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
```

## Architecture

**Framework stack:** NestJS 11, MikroORM 6 (PostgreSQL), Passport.js (session-based auth), Redis (session store), Zod (validation + serialization via nestjs-zod).

**Path aliases** (configured in `tsconfig.json`):

- `@modules/*` → `src/modules/*`
- `@entities/*` → `src/entities/*`
- `@interceptors/*` → `src/interceptors/*`
- `@/*` → `src/*`
- `@test/*` → `test/*`

**Module structure** (`src/modules/`):

- `config/` — typed `ConfigService` wrapping `@nestjs/config`; all env vars are validated at startup via `config.schema.ts` (Zod schema). Always use `ConfigService.get()` instead of `process.env` inside the app.
- `sessions/` — session CRUD, local + Google OAuth2 (Passport strategies), `AuthenticatedGuard` for protected routes.
- `users/` — user CRUD, password hashing (bcrypt), username uniqueness via slugify, Google account linking.
- `password-resets/` — token-based password reset flow with email delivery.
- `mail/` — `@nestjs-modules/mailer` with Handlebars templates in `templates/`.
- `redis/` — thin `RedisService` wrapper; the Redis client is used for session storage.
- `commands/` — `nest-commander` CLI commands (e.g. `create-superuser`). Entry point is `src/cli.ts`.
- `game-core/` — `ConfigManager` (stub) for managing game session configuration; currently in early development.

**Entities** (`src/entities/`):

- `User` — soft-delete via `deletedAt` (filter `notDeleted` applied by default), supports local + Google OAuth credentials.
- `PasswordResetToken` — one-time use token for password resets.
- `GameSession` — links to `User` (owner); stores game config as JSONB, deserialized through `ConfigManager`.

**DTOs** use `nestjs-zod` (`createZodDto`) and pull their schemas from the `@tokenizer/shared` package (GitHub: `T0kenizer/shared#feature/init`). Validation is applied globally via `ZodValidationPipe`; serialization via `ZodSerializerInterceptor`.

**Session auth flow:** Sessions are stored in Redis with `connect-redis`. Cookie is `httpOnly`/signed; `secure` + `sameSite: strict` are enabled in production only. `passport.session()` is wired globally in `setup.ts`.

**Shared package:** `@tokenizer/shared` is installed from a GitHub branch. Update it with `npm run update:shared`. Constants (field lengths, banned usernames) and Zod schemas for DTOs live there.

## Environment Variables

All required vars are defined in `src/modules/config/config.schema.ts`. The app throws at startup if any are missing:

| Variable                               | Description                      |
| -------------------------------------- | -------------------------------- |
| `POSTGRES_HOST/PORT/USER/PASSWORD/DB`  | PostgreSQL connection            |
| `REDIS_HOST/PORT`                      | Redis connection                 |
| `SMTP_HOST/PORT/FROM`                  | Mail (dev: MailHog on port 1025) |
| `SECRET_KEY`                           | Session secret                   |
| `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` | Google OAuth2                    |
| `FRONTEND_URL`                         | Used for post-OAuth redirect     |

## Database / Migrations

Entities live in `src/entities/**/*.ts`; MikroORM scans them automatically via `autoLoadEntities: true` in `AppModule`. The standalone `mikro-orm.config.ts` (used by the CLI) reads from `process.env` directly.

After modifying an entity, run `npm run makemigrations` to generate a migration, then `npm run migrate` to apply it.

## Testing conventions

Unit tests co-locate with source files (`*.spec.ts`). E2E tests live in `test/`. The Jest config maps `@factories/*` to `test/factories/` for test data factories. Run a single spec file:

```bash
npx jest src/modules/users/users.service.spec.ts
```
