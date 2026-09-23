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
  retrieveGameSessionResponseSchema,
  retrieveRoomByCodeResponseSchema,
  startHandResponseSchema,
  submitActionDataSchema,
  submitActionResponseSchema,
  updateSeatDataSchema,
  updateSeatResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Create Game Session DTOs */

export class CreateGameSessionData extends createZodDto(
  createGameSessionDataSchema,
) {}
export class CreateGameSessionResponse extends createZodDto(
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

export class RetrieveGameSessionResponse extends createZodDto(
  retrieveGameSessionResponseSchema,
) {}

/** Claim Seat DTOs */

export class ClaimSeatData extends createZodDto(claimSeatDataSchema) {}
export class ClaimSeatResponse extends createZodDto(claimSeatResponseSchema) {}

/** Update Seat DTOs */

export class UpdateSeatData extends createZodDto(updateSeatDataSchema) {}
export class UpdateSeatResponse extends createZodDto(
  updateSeatResponseSchema,
) {}

/** Start Hand DTOs */

export class StartHandResponse extends createZodDto(startHandResponseSchema) {}

/** Submit Action DTOs */

export class SubmitActionData extends createZodDto(submitActionDataSchema) {}
export class SubmitActionResponse extends createZodDto(
  submitActionResponseSchema,
) {}

/** Declare Winners DTOs */

export class DeclareWinnersData extends createZodDto(
  declareWinnersDataSchema,
) {}
export class DeclareWinnersResponse extends createZodDto(
  declareWinnersResponseSchema,
) {}

/** Close Game Session DTOs */

export class CloseGameSessionResponse extends createZodDto(
  closeGameSessionResponseSchema,
) {}
