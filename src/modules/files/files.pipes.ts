import {
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
} from '@nestjs/common';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '@tokenizer/shared/constants/files.constants';

const ALLOWED_MIME_TYPES_REGEX = new RegExp(
  `^(${ALLOWED_MIME_TYPES.join('|')})$`,
);

export function parseUploadPipe(): ParseFilePipe {
  return new ParseFilePipe({
    validators: [
      new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES }),
      new FileTypeValidator({ fileType: ALLOWED_MIME_TYPES_REGEX }),
      new FileTypeValidator({
        fileType: ALLOWED_MIME_TYPES_REGEX,
        skipMagicNumbersValidation: true,
      }),
    ],
  });
}
