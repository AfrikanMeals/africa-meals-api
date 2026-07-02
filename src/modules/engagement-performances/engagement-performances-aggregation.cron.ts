import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { EngagementPerformancesService } from './engagement-performances.service';

@Injectable()
export class EngagementPerformancesAggregationCron {
  private readonly logger = new Logger(EngagementPerformancesAggregationCron.name);

  constructor(
    private readonly performances: EngagementPerformancesService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.ENGAGEMENT_PERFORMANCE_AGGREGATION_CRON ?? '0 2 * * *')
  async runDailyAggregation(): Promise<void> {
    if (process.env.DISABLE_ENGAGEMENT_PERFORMANCE_AGGREGATION_CRON === 'true') {
      return;
    }
    await this.cronMonitor.execute('engagement_performance_daily', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      try {
        await this.performances.aggregateDailyForDate(yesterday);
      } catch (err) {
        this.logger.error(
          `engagement performance aggregation failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    });
  }
}
