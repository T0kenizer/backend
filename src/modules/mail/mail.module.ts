import { ConfigService } from '@modules/config/config.service';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import { join } from 'path';
import { MailService } from './mail.service';

@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get('SMTP_HOST'),
          port: config.get('SMTP_PORT'),
          secure: false,
          auth: config.get('SMTP_USER')
            ? {
                user: config.get('SMTP_USER'),
                pass: config.get('SMTP_PASSWORD'),
              }
            : undefined,
        },
        defaults: {
          from: config.get('SMTP_FROM'),
        },
        template: {
          dir: join(process.cwd(), 'src', 'modules', 'mail', 'templates'),
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
        options: {
          layout: 'partials/base',
          partials: {
            dir: join(
              process.cwd(),
              'src',
              'modules',
              'mail',
              'templates',
              'partials',
            ),
            options: { strict: true },
          },
        },
      }),
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
