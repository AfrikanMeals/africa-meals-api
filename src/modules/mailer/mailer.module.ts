import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MailerSend } from 'mailersend';
import {
  SiteContactRequestModel,
  SiteContactRequestSchema,
} from '@schemas/site-contact-request.schema';
import { MailerController } from './mailer.controller';
import { ContactController } from './contact.controller';
import { ContactSubmissionService } from './contact-submission.service';
import { EmailTemplateService } from './email-template.service';
import { MailerService } from './mailer.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: SiteContactRequestModel.name,
        schema: SiteContactRequestSchema,
      },
    ]),
  ],
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
    ContactSubmissionService,
  ],
  exports: [MailerService, EmailTemplateService, ContactSubmissionService],
})
export class MailerModule {}
