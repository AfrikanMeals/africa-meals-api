import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { RecommendationAutomationSettingsService } from '@modules/recommendation-automation-settings/recommendation-automation-settings.service';
import { PushRecommendationClassifierService } from './push-recommendation-classifier.service';

@Injectable()
export class PushRecommendationClassifierCron {
  private readonly logger = new Logger(PushRecommendationClassifierCron.name);

  constructor(
    private readonly classifier: PushRecommendationClassifierService,
    private readonly automationSettings: RecommendationAutomationSettingsService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.PUSH_RECO_CLASSIFIER_CRON ?? '0 4 * * *')
  async runScheduledClassifier(): Promise<void> {
    if (process.env.DISABLE_PUSH_RECO === 'true') return;
    const settings = await this.automationSettings.getRuntimeSettings();
    if (!settings.classifierCronEnabled) return;
    if (!this.automationSettings.isGloballyEnabled(settings)) return;

    await this.cronMonitor.execute('push_reco_classifier', async () => {
      try {
        const result = await this.classifier.runClassifierPass();
        this.logger.log(
          `push reco classifier: users=${result.usersProcessed} candidates=${result.candidates}`,
        );
      } catch (err) {
        this.logger.error(
          `push reco classifier failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    });
  }
}
