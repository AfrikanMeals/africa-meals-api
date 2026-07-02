import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { NewsletterAutomationSettingsService } from '@modules/newsletter-automation-settings/newsletter-automation-settings.service';
import { FoodNewsletterClassifierService } from './food-newsletter-classifier.service';

@Injectable()
export class FoodNewsletterClassifierCron {
  private readonly logger = new Logger(FoodNewsletterClassifierCron.name);

  constructor(
    private readonly classifier: FoodNewsletterClassifierService,
    private readonly automationSettings: NewsletterAutomationSettingsService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.FOOD_NEWSLETTER_CLASSIFIER_CRON ?? '0 5 * * *')
  async run(): Promise<void> {
    if (process.env.DISABLE_FOOD_NEWSLETTER === 'true') return;
    const settings = await this.automationSettings.getRuntimeSettings();
    if (!settings.classifierCronEnabled) return;
    await this.cronMonitor.execute('food_newsletter_classifier', async () => {
      const result = await this.classifier.runClassifierPass();
      this.logger.log(
        `food newsletter classifier: users=${result.usersProcessed} candidates=${result.candidates}`,
      );
    });
  }
}
