import {
  claimSeatDataSchema,
  claimSeatResponseSchema,
  closeGameSessionResponseSchema,
  createGameSessionDataSchema,
  createGameSessionResponseSchema,
  declareWinnersDataSchema,
  declareWinnersResponseSchema,
  joinByCodeDataSchema,
  joinByCodeResponseSchema,
  listGameModesResponseSchema,
  resolveRoundDataSchema,
  resolveRoundResponseSchema,
  retrieveGameSessionResponseSchema,
  retrieveRoomByCodeResponseSchema,
  startHandResponseSchema,
  startRoundResponseSchema,
  submitActionDataSchema,
  submitActionResponseSchema,
  updateSeatDataSchema,
  updateSeatResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';
import type { z } from 'zod';

/**
 * A DTO over a schema whose parsed value is a union.
 *
 * `createZodDto` types its base class as `new () => <the parsed value>`, and a
 * class cannot extend one whose instances are a union — which every response
 * carrying a `GameSnapshot` now is, since the snapshot is discriminated on
 * `mode`. The runtime is unaffected: the serializer only ever calls
 * `schema.parse`, and a discriminated union parses exactly as it should. So the
 * schema is handed over as-is and only its _static_ shape is widened, here, in
 * one place, rather than by weakening the contract itself.
 */
const unionDto = (schema: z.ZodType) =>
  createZodDto(schema as unknown as z.ZodObject<z.ZodRawShape>);

/** Create Game Session DTOs */

export class CreateGameSessionData extends createZodDto(
  createGameSessionDataSchema,
) {}
export class CreateGameSessionResponse extends unionDto(
  createGameSessionResponseSchema,
) {}

/** List Game Modes DTOs */

export class ListGameModesResponse extends createZodDto(
  listGameModesResponseSchema,
) {}

/** Join By Code DTOs */

export class JoinByCodeData extends createZodDto(joinByCodeDataSchema) {}
export class JoinByCodeResponse extends createZodDto(
  joinByCodeResponseSchema,
) {}

/** Retrieve Room By Code DTOs */

export class RetrieveRoomByCodeResponse extends createZodDto(
  retrieveRoomByCodeResponseSchema,
) {}

/** Retrieve Game Session DTOs */

export class RetrieveGameSessionResponse extends unionDto(
  retrieveGameSessionResponseSchema,
) {}

/** Claim Seat DTOs */

export class ClaimSeatData extends createZodDto(claimSeatDataSchema) {}
export class ClaimSeatResponse extends unionDto(claimSeatResponseSchema) {}

/** Update Seat DTOs */

export class UpdateSeatData extends createZodDto(updateSeatDataSchema) {}
export class UpdateSeatResponse extends unionDto(updateSeatResponseSchema) {}

/** Start Hand DTOs */

export class StartHandResponse extends unionDto(startHandResponseSchema) {}

/** Start Round DTOs */

export class StartRoundResponse extends unionDto(startRoundResponseSchema) {}

/** Submit Action DTOs */

export class SubmitActionData extends createZodDto(submitActionDataSchema) {}
export class SubmitActionResponse extends unionDto(
  submitActionResponseSchema,
) {}

/** Declare Winners DTOs */

export class DeclareWinnersData extends createZodDto(
  declareWinnersDataSchema,
) {}
export class DeclareWinnersResponse extends unionDto(
  declareWinnersResponseSchema,
) {}

/** Resolve Round DTOs */

export class ResolveRoundData extends createZodDto(resolveRoundDataSchema) {}
export class ResolveRoundResponse extends unionDto(
  resolveRoundResponseSchema,
) {}

/** Close Game Session DTOs */

export class CloseGameSessionResponse extends unionDto(
  closeGameSessionResponseSchema,
) {}
