import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { SearchSettingsService } from '@modules/search-settings/search-settings.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RecommendationTrainingService } from './recommendation-training.service';

/**
 * Job récurrent : agrège signaux / catalogue / ventes, met à jour snapshot + digests.
 *
 * `RECOMMENDATION_TRAINING_CRON` — expression cron (défaut : tous les jours à 03:15 UTC).
 * `DISABLE_RECOMMENDATION_TRAINING_CRON=true` — désactive l’exécution planifiée.
 * Respecte aussi `trainingCronEnabled` dans les paramètres admin.
 */
@Injectable()
export class RecommendationTrainingCron {
  private readonly _logger = new Logger(RecommendationTrainingCron.name);

  constructor(
    private readonly _training: RecommendationTrainingService,
    private readonly _searchSettings: SearchSettingsService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.RECOMMENDATION_TRAINING_CRON ?? '15 3 * * *')
  async runScheduledTraining(): Promise<void> {
    if (process.env.DISABLE_RECOMMENDATION_TRAINING_CRON === 'true') {
      return;
    }
    const runtime = await this._searchSettings.getSearchRuntimeConfig();
    if (!runtime.trainingCronEnabled) {
      return;
    }

    await this.cronMonitor.execute('recommendation_training', async () => {
      try {
        await this._training.runTrainingPass();
      } catch (e) {
        this._logger.error(
          `recommendation training failed: ${
            (e as Error).stack ?? (e as Error).message
          }`,
        );
        throw e;
      }
    });
  }
}
