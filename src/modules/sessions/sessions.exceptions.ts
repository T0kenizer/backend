import { UnauthorizedException } from '@nestjs/common';

export class GoogleEmailNotVerifiedException extends UnauthorizedException {
  constructor() {
    super('Google account has no verified email');
  }
}
