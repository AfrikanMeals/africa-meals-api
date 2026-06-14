import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  SearchSettingsService,
  SearchVectorReindexService,
} from './search-settings.service';

/**
 * Ré-indexation catalogue pour recherche texte / vectorielle.
 *
 * `SEARCH_REINDEX_CRON` — expression cron (défaut : tous les jours à 04:00 UTC).
 * `DISABLE_SEARCH_REINDEX_CRON=true` — désactive l’exécution planifiée.
 * Le cron respecte aussi `reindexCronEnabled` dans les paramètres admin.
 */
@Injectable()
export class SearchVectorReindexCron {
  private readonly _logger = new Logger(SearchVectorReindexCron.name);

  constructor(
    private readonly _reindex: SearchVectorReindexService,
    private readonly _settings: SearchSettingsService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.SEARCH_REINDEX_CRON ?? '0 4 * * *')
  async runScheduledReindex(): Promise<void> {
    if (process.env.DISABLE_SEARCH_REINDEX_CRON === 'true') {
      return;
    }
    const runtime = await this._settings.getSearchRuntimeConfig();
    if (!runtime.reindexCronEnabled) {
      return;
    }

    await this.cronMonitor.execute('search_vector_reindex', async () => {
      try {
        const result = await this._reindex.runReindex();
        this._logger.log(result.message);
      } catch (e) {
        this._logger.error(
          `search reindex failed: ${(e as Error).stack ?? (e as Error).message}`,
        );
        throw e;
      }
    });
  }
}
