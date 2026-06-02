import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerSend } from 'mailersend';
import { MailerController } from './mailer.controller';
import { ContactController } from './contact.controller';
import { EmailTemplateService } from './email-template.service';
import { MailerService } from './mailer.service';

@Module({
  controllers: [MailerController, ContactController],
  providers: [
    {
      provide: 'MAILER',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MailerSend({
          apiKey: config.get<string>('MAILER_API_KEY') ?? '',
        }),
    },
    EmailTemplateService,
    MailerService,
  ],
  exports: [MailerService, EmailTemplateService],
})
export class MailerModule {}
