import {
  BadRequestException,
  ConflictException,
  HttpStatus,
} from '@nestjs/common';

/** Maps a request body field name to the error message to display on it. */
export type FieldErrors = Record<string, string>;

const buildResponse = (
  statusCode: HttpStatus,
  error: string,
  fields: FieldErrors,
  message?: string,
) => ({
  statusCode,
  error,
  message: message ?? Object.values(fields).join(', '),
  fields,
});

/**
 * Conflict (409) scoped to one or more request body fields, so the frontend can
 * display the message directly on the matching form inputs.
 */
export class FieldConflictException extends ConflictException {
  constructor(fields: FieldErrors, message?: string) {
    super(buildResponse(HttpStatus.CONFLICT, 'Conflict', fields, message));
  }
}

/**
 * Bad request (400) scoped to one or more request body fields, so the frontend
 * can display the message directly on the matching form inputs.
 */
export class FieldBadRequestException extends BadRequestException {
  constructor(fields: FieldErrors, message?: string) {
    super(
      buildResponse(HttpStatus.BAD_REQUEST, 'Bad Request', fields, message),
    );
  }
}
