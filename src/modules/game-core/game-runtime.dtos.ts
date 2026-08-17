import {
  closeGameSessionResponseSchema,
  createGameSessionDataSchema,
  createGameSessionResponseSchema,
  joinGameSessionDataSchema,
  joinGameSessionResponseSchema,
  resolveRoundDataSchema,
  resolveRoundResponseSchema,
  retrieveGameSessionResponseSchema,
  startRoundResponseSchema,
  submitActionDataSchema,
  submitActionResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Create Game Session DTOs */

export class CreateGameSessionData extends createZodDto(
  createGameSessionDataSchema,
) {}
export class CreateGameSessionResponse extends createZodDto(
  createGameSessionResponseSchema,
) {}

/** Retrieve Game Session DTOs */

export class RetrieveGameSessionResponse extends createZodDto(
  retrieveGameSessionResponseSchema,
) {}

/** Join Game Session DTOs */

export class JoinGameSessionData extends createZodDto(
  joinGameSessionDataSchema,
) {}
export class JoinGameSessionResponse extends createZodDto(
  joinGameSessionResponseSchema,
) {}

/** Start Round DTOs */

export class StartRoundResponse extends createZodDto(
  startRoundResponseSchema,
) {}

/** Submit Action DTOs */

export class SubmitActionData extends createZodDto(submitActionDataSchema) {}
export class SubmitActionResponse extends createZodDto(
  submitActionResponseSchema,
) {}

/** Resolve Round DTOs */

export class ResolveRoundData extends createZodDto(resolveRoundDataSchema) {}
export class ResolveRoundResponse extends createZodDto(
  resolveRoundResponseSchema,
) {}

/** Close Game Session DTOs */

export class CloseGameSessionResponse extends createZodDto(
  closeGameSessionResponseSchema,
) {}
