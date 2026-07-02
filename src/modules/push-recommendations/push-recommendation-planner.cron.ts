import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { RecommendationAutomationSettingsService } from '@modules/recommendation-automation-settings/recommendation-automation-settings.service';
import { PushRecommendationPlannerService } from './push-recommendation-planner.service';

@Injectable()
export class PushRecommendationPlannerCron {
  private readonly logger = new Logger(PushRecommendationPlannerCron.name);

  constructor(
    private readonly planner: PushRecommendationPlannerService,
    private readonly automationSettings: RecommendationAutomationSettingsService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.PUSH_RECO_PLANNER_CRON ?? '*/20 * * * *')
  async runScheduledPlanner(): Promise<void> {
    if (process.env.DISABLE_PUSH_RECO === 'true') return;
    const settings = await this.automationSettings.getRuntimeSettings();
    if (!settings.plannerCronEnabled) return;
    if (!this.automationSettings.isGloballyEnabled(settings)) return;

    await this.cronMonitor.execute('push_reco_planner', async () => {
      try {
        const result = await this.planner.runPlannerPass();
        this.logger.log(
          `push reco planner: planned=${result.planned} delivered=${result.delivered} skipped=${result.skipped}`,
        );
      } catch (err) {
        this.logger.error(
          `push reco planner failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    });
  }
}
