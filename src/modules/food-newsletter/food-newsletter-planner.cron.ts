import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { NewsletterAutomationSettingsService } from '@modules/newsletter-automation-settings/newsletter-automation-settings.service';
import { FoodNewsletterPlannerService } from './food-newsletter-planner.service';

@Injectable()
export class FoodNewsletterPlannerCron {
  private readonly logger = new Logger(FoodNewsletterPlannerCron.name);

  constructor(
    private readonly planner: FoodNewsletterPlannerService,
    private readonly automationSettings: NewsletterAutomationSettingsService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.FOOD_NEWSLETTER_PLANNER_CRON ?? '0 9 * * 2,4')
  async run(): Promise<void> {
    if (process.env.DISABLE_FOOD_NEWSLETTER === 'true') return;
    const settings = await this.automationSettings.getRuntimeSettings();
    if (!settings.plannerCronEnabled) return;
    await this.cronMonitor.execute('food_newsletter_planner', async () => {
      const result = await this.planner.runPlannerPass();
      this.logger.log(
        `food newsletter planner: planned=${result.planned} delivered=${result.delivered} skipped=${result.skipped}`,
      );
    });
  }
}
