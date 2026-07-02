import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  NewsletterAutomationSettingsModel,
  NewsletterAutomationSettingsSchema,
} from '@schemas/newsletter-automation-settings.schema';
import { NewsletterAutomationSettingsController } from './newsletter-automation-settings.controller';
import { NewsletterAutomationSettingsService } from './newsletter-automation-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: NewsletterAutomationSettingsModel.name,
        schema: NewsletterAutomationSettingsSchema,
      },
    ]),
  ],
  controllers: [NewsletterAutomationSettingsController],
  providers: [NewsletterAutomationSettingsService],
  exports: [NewsletterAutomationSettingsService],
})
export class NewsletterAutomationSettingsModule {}
