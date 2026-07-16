import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  public sendPasswordReset(email: string, resetUrl: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Reset your password',
      template: 'reset-password',
      context: {
        resetUrl,
        title: 'Reset your password',
        year: new Date().getFullYear(),
      },
    });
  }

  public sendAccountDeletion(email: string, deleteUrl: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Confirm account deletion',
      template: 'account-deletion',
      context: {
        deleteUrl,
        title: 'Delete your account',
        year: new Date().getFullYear(),
      },
    });
  }
}
