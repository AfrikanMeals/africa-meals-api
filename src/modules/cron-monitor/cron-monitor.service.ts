import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  CRON_JOBS_REGISTRY,
  getCronJobDefinition,
  isKnownCronJobKey,
  type CronJobDefinition,
} from '@modules/cron-monitor/cron-jobs.registry';
import {
  CronJobLastRunStatusEnum,
  InfraCronJobStateModel,
} from '@schemas/infra-cron-job-state.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';

export type CronJobAdminStatus = 'active' | 'paused' | 'disabled_env';

export type CronJobAdminView = {
  key: string;
  label: string;
  description: string;
  schedule: string;
  scheduleFromEnv: boolean;
  disableEnvVar: string;
  envDisabled: boolean;
  paused: boolean;
  status: CronJobAdminStatus;
  lastRunAt: string | null;
  lastRunStatus: CronJobLastRunStatusEnum | null;
  lastRunMessage: string | null;
  lastDurationMs: number | null;
  updatedAt: string | null;
};

@Injectable()
export class CronMonitorService {
  private readonly logger = new Logger(CronMonitorService.name);

  constructor(
    @InjectModel(InfraCronJobStateModel.name)
    private readonly stateModel: Model<InfraCronJobStateModel>,
    private readonly storeAccess: StoreAccessService,
  ) {}

  private async assertAdminSettings(user: UserModel): Promise<void> {
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private envDisabled(def: CronJobDefinition): boolean {
    return process.env[def.disableEnvKey] === 'true';
  }

  private resolveSchedule(def: CronJobDefinition): {
    schedule: string;
    scheduleFromEnv: boolean;
  } {
    const fromEnv = process.env[def.scheduleEnvKey]?.trim();
    if (fromEnv) {
      return { schedule: fromEnv, scheduleFromEnv: true };
    }
    return { schedule: def.defaultSchedule, scheduleFromEnv: false };
  }

  private resolveStatus(
    def: CronJobDefinition,
    paused: boolean,
  ): CronJobAdminStatus {
    if (this.envDisabled(def)) return 'disabled_env';
    if (paused) return 'paused';
    return 'active';
  }

  private toView(
    def: CronJobDefinition,
    doc: InfraCronJobStateModel | null,
  ): CronJobAdminView {
    const paused = doc?.paused === true;
    const { schedule, scheduleFromEnv } = this.resolveSchedule(def);
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      schedule,
      scheduleFromEnv,
      disableEnvVar: def.disableEnvKey,
      envDisabled: this.envDisabled(def),
      paused,
      status: this.resolveStatus(def, paused),
      lastRunAt: doc?.lastRunAt?.toISOString?.() ?? null,
      lastRunStatus: doc?.lastRunStatus ?? null,
      lastRunMessage: doc?.lastRunMessage ?? null,
      lastDurationMs:
        doc?.lastDurationMs != null ? Math.trunc(doc.lastDurationMs) : null,
      updatedAt:
        (doc as { updatedAt?: Date } | null)?.updatedAt?.toISOString?.() ?? null,
    };
  }

  getSkipReason(key: string): string | null {
    const def = getCronJobDefinition(key);
    if (!def) return 'unknown_cron_job';
    if (this.envDisabled(def)) return 'disabled_via_env';
    return null;
  }

  async isPausedInDb(key: string): Promise<boolean> {
    const doc = await this.stateModel.findOne({ key }).lean().exec();
    return doc?.paused === true;
  }

  async shouldRun(key: string): Promise<boolean> {
    if (this.getSkipReason(key)) return false;
    return !(await this.isPausedInDb(key));
  }

  async recordRun(
    key: string,
    input: {
      status: CronJobLastRunStatusEnum;
      message?: string;
      durationMs?: number;
    },
  ): Promise<void> {
    if (!isKnownCronJobKey(key)) return;
    await this.stateModel
      .updateOne(
        { key },
        {
          $set: {
            key,
            lastRunAt: new Date(),
            lastRunStatus: input.status,
            lastRunMessage: input.message?.slice(0, 500) ?? null,
            lastDurationMs:
              input.durationMs != null ? Math.trunc(input.durationMs) : null,
          },
          $setOnInsert: { paused: false },
        },
        { upsert: true },
      )
      .exec();
  }

  /**
   * Enveloppe d'exécution cron : respecte pause admin + DISABLE_* env, journalise le run.
   */
  async execute(key: string, fn: () => Promise<void>): Promise<void> {
    const envReason = this.getSkipReason(key);
    if (envReason) {
      await this.recordRun(key, {
        status: CronJobLastRunStatusEnum.SKIPPED,
        message: envReason,
      });
      return;
    }
    if (await this.isPausedInDb(key)) {
      await this.recordRun(key, {
        status: CronJobLastRunStatusEnum.SKIPPED,
        message: 'paused_via_admin',
      });
      return;
    }

    const start = Date.now();
    try {
      await fn();
      await this.recordRun(key, {
        status: CronJobLastRunStatusEnum.OK,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.recordRun(key, {
        status: CronJobLastRunStatusEnum.ERROR,
        message,
        durationMs: Date.now() - start,
      });
      this.logger.warn(`[cron:${key}] ${message}`);
      throw e;
    }
  }

  /**
   * Exécution manuelle depuis l’admin : ignore pause / DISABLE_* env, journalise le run.
   */
  async executeManual(
    key: string,
    fn: () => Promise<void | string>,
    options?: { adminUserId?: string },
  ): Promise<{
    status: CronJobLastRunStatusEnum;
    message: string | null;
    durationMs: number;
  }> {
    if (!isKnownCronJobKey(key)) {
      throw new BadRequestException('unknown_cron_job');
    }

    const start = Date.now();
    const manualTag = options?.adminUserId
      ? `manual_run_by_admin:${options.adminUserId}`
      : 'manual_run';

    try {
      const detail = await fn();
      const durationMs = Date.now() - start;
      const message =
        typeof detail === 'string' && detail.trim()
          ? `${manualTag} — ${detail.trim()}`
          : manualTag;
      await this.recordRun(key, {
        status: CronJobLastRunStatusEnum.OK,
        durationMs,
        message,
      });
      return {
        status: CronJobLastRunStatusEnum.OK,
        message,
        durationMs,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const durationMs = Date.now() - start;
      await this.recordRun(key, {
        status: CronJobLastRunStatusEnum.ERROR,
        message: errMsg,
        durationMs,
      });
      this.logger.warn(`[cron:${key}:manual] ${errMsg}`);
      return {
        status: CronJobLastRunStatusEnum.ERROR,
        message: errMsg,
        durationMs,
      };
    }
  }

  async getJobView(key: string): Promise<CronJobAdminView> {
    const def = getCronJobDefinition(key);
    if (!def) {
      throw new BadRequestException('unknown_cron_job');
    }
    const doc = await this.stateModel.findOne({ key: def.key }).lean().exec();
    return this.toView(def, (doc as InfraCronJobStateModel) ?? null);
  }

  async runJobManually(
    user: UserModel,
    key: string,
    fn: () => Promise<void | string>,
  ): Promise<{
    ok: boolean;
    key: string;
    status: CronJobLastRunStatusEnum;
    message: string | null;
    durationMs: number;
    job: CronJobAdminView;
  }> {
    await this.assertAdminSettings(user);
    const normalized = key.trim();
    const exec = await this.executeManual(normalized, fn, {
      adminUserId: String(user._id),
    });
    const job = await this.getJobView(normalized);
    return {
      ok: exec.status === CronJobLastRunStatusEnum.OK,
      key: normalized,
      status: exec.status,
      message: exec.message,
      durationMs: exec.durationMs,
      job,
    };
  }

  async listJobsForAdmin(user: UserModel): Promise<{ jobs: CronJobAdminView[] }> {
    await this.assertAdminSettings(user);
    const docs = await this.stateModel.find().lean().exec();
    const byKey = new Map(docs.map((d) => [String(d.key), d]));
    const jobs = CRON_JOBS_REGISTRY.map((def) =>
      this.toView(def, (byKey.get(def.key) as InfraCronJobStateModel) ?? null),
    );
    return { jobs };
  }

  async setJobPaused(
    user: UserModel,
    key: string,
    paused: boolean,
  ): Promise<CronJobAdminView> {
    await this.assertAdminSettings(user);
    const def = getCronJobDefinition(key);
    if (!def) {
      throw new BadRequestException('unknown_cron_job');
    }
    if (this.envDisabled(def) && !paused) {
      throw new BadRequestException('cron_job_disabled_via_env');
    }
    const doc = await this.stateModel
      .findOneAndUpdate(
        { key: def.key },
        { $set: { key: def.key, paused: paused === true }, $setOnInsert: {} },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.logger.log(
      `[cron-monitor] ${def.key} ${paused ? 'paused' : 'resumed'} by admin ${String(user._id)}`,
    );
    return this.toView(def, doc);
  }
}
