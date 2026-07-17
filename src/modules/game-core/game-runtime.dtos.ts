import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Runtime API DTOs. These POC endpoints define their schemas locally; once the
 * shapes stabilise they should migrate to the shared `@tokenizer/shared`
 * package like the rest of the app's DTOs.
 */

/** Custom config is passed through opaquely; omit it to use the default preset. */
const createGameSchema = z.object({
  config: z.unknown().optional(),
});

const joinGameSchema = z.object({
  /** Authenticated user UUID or an anonymous client id. */
  externalId: z.string().min(1),
  displayName: z.string().min(1).max(60),
  initialBalance: z.number().int().nonnegative().default(1000),
});

const submitActionSchema = z.object({
  externalId: z.string().min(1),
  definitionId: z.string().min(1),
  amount: z.number().int().nonnegative().optional(),
});

const resolveRoundSchema = z.object({
  winnerExternalIds: z.array(z.string().min(1)).optional(),
});

export class CreateGameData extends createZodDto(createGameSchema) {}
export class JoinGameData extends createZodDto(joinGameSchema) {}
export class SubmitActionData extends createZodDto(submitActionSchema) {}
export class ResolveRoundData extends createZodDto(resolveRoundSchema) {}
