import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MailerSend } from 'mailersend';
import {
  NewsletterSubscriberModel,
  NewsletterSubscriberSchema,
} from '@schemas/newsletter-subscriber.schema';
import {
  SiteContactRequestModel,
  SiteContactRequestSchema,
} from '@schemas/site-contact-request.schema';
import { MailerController } from './mailer.controller';
import { ContactController } from './contact.controller';
import { NewsletterController } from './newsletter.controller';
import { ContactSubmissionService } from './contact-submission.service';
import { EmailTemplateService } from './email-template.service';
import { MailerService } from './mailer.service';
import { NewsletterSubscriptionService } from './newsletter-subscription.service';
import { RecaptchaEnterpriseService } from './recaptcha-enterprise.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: SiteContactRequestModel.name,
        schema: SiteContactRequestSchema,
      },
      {
        name: NewsletterSubscriberModel.name,
        schema: NewsletterSubscriberSchema,
      },
    ]),
  ],
  controllers: [MailerController, ContactController, NewsletterController],
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
    NewsletterSubscriptionService,
    RecaptchaEnterpriseService,
  ],
  exports: [
    MailerService,
    EmailTemplateService,
    ContactSubmissionService,
    NewsletterSubscriptionService,
    RecaptchaEnterpriseService,
  ],
})
export class MailerModule {}
