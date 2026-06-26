import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AdminJobEmitterService } from '@modules/admin-jobs/admin-job-emitter.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  DatabaseBackupRunDocument,
  DatabaseBackupRunModel,
  DatabaseOperationType,
} from '@schemas/database-backup-run.schema';
import {
  DatabaseBackupIntervalUnit,
  DatabaseFullBackupSchedule,
  DatabaseSettingsDocument,
  DatabaseSettingsModel,
} from '@schemas/database-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { DatabaseOperationsService } from './database-operations.service';
import {
  buildMongoUriFromMigrationDto,
  summarizeMongoUri,
} from './database-uri.util';
import { RestoreBackupDto } from './dto/restore-backup.dto';
import { TriggerBackupDto } from './dto/trigger-backup.dto';
import { TriggerMigrationDto } from './dto/trigger-migration.dto';
import { UpdateDatabaseSettingsDto } from './dto/update-database-settings.dto';
import { TestDatabaseConnectionDto } from './dto/test-database-connection.dto';
import type { DatabaseConnectionTestResult } from './database-operations.service';

const SETTINGS_KEY = 'default';
const MIGRATION_CONFIRM = 'MIGRER_AFRIKAMEALS';
const RESTORE_CONFIRM = 'RESTAURER_AFRIKAMEALS';

export type DatabaseSettingsResponse = {
  incrementalBackupEnabled: boolean;
  incrementalBackupIntervalUnit: DatabaseBackupIntervalUnit;
  incrementalBackupIntervalValue: number;
  fullBackupEnabled: boolean;
  fullBackupSchedule: DatabaseFullBackupSchedule;
  fullBackupHourUtc: number;
  fullBackupDayOfWeek: number;
  fullBackupDayOfMonth: number;
  backupRetentionDays: number;
  lastIncrementalBackupAt: string | null;
  lastFullBackupAt: string | null;
  backupRootDir: string;
  dbBackupAllowed: boolean;
  updatedAt: string | null;
};

export type DatabaseBackupRunResponse = {
  id: string;
  type: DatabaseOperationType;
  status: string;
  triggeredByEmail: string;
  jobId: string;
  storagePath: string;
  sizeBytes: number;
  collections: DatabaseBackupRunModel['collections'];
  targetSummary: string;
  errorMessage: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

@Injectable()
export class DatabaseSettingsService {
  private readonly logger = new Logger(DatabaseSettingsService.name);

  constructor(
    @InjectModel(DatabaseSettingsModel.name)
    private readonly settingsModel: Model<DatabaseSettingsDocument>,
    @InjectModel(DatabaseBackupRunModel.name)
    private readonly backupRunModel: Model<DatabaseBackupRunDocument>,
    private readonly operations: DatabaseOperationsService,
    private readonly storeAccess: StoreAccessService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => AdminJobEmitterService))
    @Optional()
    private readonly adminJobEmitter?: AdminJobEmitterService,
  ) {}

  isDbBackupAllowed(): boolean {
    const raw = this.config.get<string>('ALLOW_DB_BACKUP');
    const normalized = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
    const nodeEnv = String(
      this.config.get('NODE_ENV') ?? process.env.NODE_ENV ?? '',
    )
      .trim()
      .toLowerCase();
    if (
      nodeEnv === 'production' &&
      normalized !== 'true' &&
      normalized !== '1'
    ) {
      return false;
    }
    return true;
  }

  private assertDbBackupEnabled(): void {
    if (!this.isDbBackupAllowed()) {
      throw new ForbiddenException('db_backup_disabled');
    }
  }

  private async assertAdminSettings(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private async assertAdminBackup(user: UserModel): Promise<void> {
    await this.assertAdminSettings(user);
    this.assertDbBackupEnabled();
  }

  private toSettingsResponse(doc: DatabaseSettingsModel): DatabaseSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      incrementalBackupEnabled: doc.incrementalBackupEnabled,
      incrementalBackupIntervalUnit: doc.incrementalBackupIntervalUnit,
      incrementalBackupIntervalValue: doc.incrementalBackupIntervalValue,
      fullBackupEnabled: doc.fullBackupEnabled,
      fullBackupSchedule: doc.fullBackupSchedule,
      fullBackupHourUtc: doc.fullBackupHourUtc,
      fullBackupDayOfWeek: doc.fullBackupDayOfWeek,
      fullBackupDayOfMonth: doc.fullBackupDayOfMonth,
      backupRetentionDays: doc.backupRetentionDays,
      lastIncrementalBackupAt: doc.lastIncrementalBackupAt?.toISOString?.() ?? null,
      lastFullBackupAt: doc.lastFullBackupAt?.toISOString?.() ?? null,
      backupRootDir: this.operations.backupRootDir(),
      dbBackupAllowed: this.isDbBackupAllowed(),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  private toRunResponse(doc: DatabaseBackupRunDocument): DatabaseBackupRunResponse {
    const typed = doc as unknown as { createdAt?: Date };
    return {
      id: String(doc._id),
      type: doc.type,
      status: doc.status,
      triggeredByEmail: doc.triggeredByEmail,
      jobId: doc.jobId,
      storagePath: doc.storagePath,
      sizeBytes: doc.sizeBytes,
      collections: doc.collections ?? [],
      targetSummary: doc.targetSummary,
      errorMessage: doc.errorMessage,
      startedAt: doc.startedAt?.toISOString?.() ?? null,
      completedAt: doc.completedAt?.toISOString?.() ?? null,
      createdAt: typed.createdAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }

  private async ensureSettingsDoc(): Promise<DatabaseSettingsModel> {
    return this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $setOnInsert: { key: SETTINGS_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async getSettings(user: UserModel): Promise<DatabaseSettingsResponse> {
    await this.assertAdminSettings(user);
    const doc = await this.ensureSettingsDoc();
    return this.toSettingsResponse(doc);
  }

  async testConnection(
    user: UserModel,
    dto?: TestDatabaseConnectionDto,
  ): Promise<DatabaseConnectionTestResult> {
    await this.assertAdminSettings(user);

    const hasCustomTarget = Boolean(
      String(dto?.uri ?? '').trim() ||
        String(dto?.host ?? '').trim() ||
        String(dto?.database ?? '').trim(),
    );

    if (!hasCustomTarget) {
      return this.operations.testConnection();
    }

    const targetUri = buildMongoUriFromMigrationDto(dto ?? {});
    return this.operations.testConnection(targetUri);
  }

  async updateSettings(
    user: UserModel,
    dto: UpdateDatabaseSettingsDto,
  ): Promise<DatabaseSettingsResponse> {
    await this.assertAdminSettings(user);
    const $set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        $set[key] = value;
      }
    }
    const updated = await this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set, $setOnInsert: { key: SETTINGS_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.toSettingsResponse(updated);
  }

  async listBackupHistory(
    user: UserModel,
    limit = 50,
  ): Promise<{ runs: DatabaseBackupRunResponse[] }> {
    await this.assertAdminSettings(user);
    const capped = Math.min(Math.max(limit, 1), 200);
    const rows = await this.backupRunModel
      .find()
      .sort({ createdAt: -1 })
      .limit(capped)
      .exec();
    return { runs: rows.map((r) => this.toRunResponse(r)) };
  }

  async triggerBackupAsync(
    user: UserModel,
    dto: TriggerBackupDto,
  ): Promise<{ jobId: string; runId: string }> {
    await this.assertAdminBackup(user);
    return this.startBackupJob(user, dto.type, 'manual');
  }

  async triggerMigrationAsync(
    user: UserModel,
    dto: TriggerMigrationDto,
  ): Promise<{ jobId: string; runId: string }> {
    await this.assertAdminBackup(user);
    if (dto.confirmPhrase.trim() !== MIGRATION_CONFIRM) {
      throw new BadRequestException('migration_confirm_required');
    }

    const targetUri = buildMongoUriFromMigrationDto(dto);
    const targetSummary = summarizeMongoUri(targetUri);
    const jobId = randomUUID();
    const runId = randomUUID();

    const run = await this.backupRunModel.create({
      type: 'migration',
      status: 'running',
      triggeredBy: user._id,
      triggeredByEmail: user.email ?? '',
      jobId,
      storagePath: '',
      targetSummary,
      startedAt: new Date(),
    });

    await this.adminJobEmitter?.emitProgress({
      jobId,
      pct: 0,
      label: 'Migration démarrée…',
      phase: 'starting',
    });

    void this.runMigrationJob(
      user,
      jobId,
      String(run._id),
      targetUri,
      dto.dropTargetCollections === true,
    ).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Migration job ${jobId} failed: ${msg}`);
      void this.adminJobEmitter?.emitFailed({ jobId, error: msg });
    });

    return { jobId, runId: String(run._id) };
  }

  async triggerRestoreAsync(
    user: UserModel,
    dto: RestoreBackupDto,
  ): Promise<{ jobId: string; runId: string }> {
    await this.assertAdminBackup(user);
    if (dto.confirmPhrase.trim() !== RESTORE_CONFIRM) {
      throw new BadRequestException('restore_confirm_required');
    }

    const source = await this.backupRunModel.findById(dto.backupRunId).exec();
    if (!source) {
      throw new BadRequestException('backup_run_not_found');
    }
    if (source.status !== 'completed') {
      throw new BadRequestException('backup_run_not_restorable');
    }
    if (source.type !== 'incremental' && source.type !== 'full') {
      throw new BadRequestException('backup_run_not_restorable');
    }
    if (!source.storagePath) {
      throw new BadRequestException('backup_storage_missing');
    }

    const jobId = randomUUID();
    const run = await this.backupRunModel.create({
      type: 'restore',
      status: 'running',
      triggeredBy: user._id,
      triggeredByEmail: user.email ?? '',
      jobId,
      storagePath: source.storagePath,
      targetSummary: `restore-from:${source._id}`,
      startedAt: new Date(),
    });

    void this.runRestoreJob(
      user,
      jobId,
      String(run._id),
      source.storagePath,
    ).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Restore job ${jobId} failed: ${msg}`);
      void this.adminJobEmitter?.emitFailed({ jobId, error: msg });
    });

    return { jobId, runId: String(run._id) };
  }

  async runScheduledBackups(): Promise<void> {
    if (!this.isDbBackupAllowed()) return;

    const settings = await this.ensureSettingsDoc();
    const now = new Date();

    if (
      settings.incrementalBackupEnabled &&
      this.isIncrementalDue(settings, now)
    ) {
      await this.startBackupJob(null, 'incremental', 'cron');
    }

    if (settings.fullBackupEnabled && this.isFullBackupDue(settings, now)) {
      await this.startBackupJob(null, 'full', 'cron');
    }

    if (settings.backupRetentionDays > 0) {
      const removed = await this.operations.purgeExpiredBackups(
        settings.backupRetentionDays,
      );
      if (removed > 0) {
        this.logger.log(`Purged ${removed} expired backup folder(s).`);
      }
    }
  }

  private isIncrementalDue(
    settings: DatabaseSettingsModel,
    now: Date,
  ): boolean {
    const last = settings.lastIncrementalBackupAt;
    if (!last) return true;
    const ms = this.intervalToMs(
      settings.incrementalBackupIntervalUnit,
      settings.incrementalBackupIntervalValue,
    );
    return now.getTime() - last.getTime() >= ms;
  }

  private isFullBackupDue(
    settings: DatabaseSettingsModel,
    now: Date,
  ): boolean {
    if (now.getUTCHours() !== settings.fullBackupHourUtc) {
      return false;
    }

    if (settings.fullBackupSchedule === 'weekly') {
      const dow = this.utcIsoDayOfWeek(now);
      if (dow !== settings.fullBackupDayOfWeek) return false;
    }

    if (settings.fullBackupSchedule === 'monthly') {
      if (now.getUTCDate() !== settings.fullBackupDayOfMonth) return false;
    }

    const last = settings.lastFullBackupAt;
    if (!last) return true;

    if (settings.fullBackupSchedule === 'daily') {
      return last.getUTCDate() !== now.getUTCDate() ||
        last.getUTCMonth() !== now.getUTCMonth() ||
        last.getUTCFullYear() !== now.getUTCFullYear();
    }

    if (settings.fullBackupSchedule === 'weekly') {
      return this.weekKey(last) !== this.weekKey(now);
    }

    return (
      last.getUTCMonth() !== now.getUTCMonth() ||
      last.getUTCFullYear() !== now.getUTCFullYear()
    );
  }

  /** 1=lundi … 7=dimanche (UTC). */
  private utcIsoDayOfWeek(date: Date): number {
    const d = date.getUTCDay();
    return d === 0 ? 7 : d;
  }

  private weekKey(date: Date): string {
    const d = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${week}`;
  }

  private intervalToMs(
    unit: DatabaseBackupIntervalUnit,
    value: number,
  ): number {
    const v = Math.max(1, value);
    switch (unit) {
      case 'hour':
        return v * 3_600_000;
      case 'day':
        return v * 86_400_000;
      case 'week':
        return v * 604_800_000;
      case 'month':
        return v * 2_592_000_000;
      default:
        return v * 86_400_000;
    }
  }

  private async startBackupJob(
    user: UserModel | null,
    type: 'incremental' | 'full',
    source: 'manual' | 'cron',
  ): Promise<{ jobId: string; runId: string }> {
    const jobId = randomUUID();
    const runId = randomUUID();
    const runDir = this.operations.resolveRunDir(type, runId);

    const run = await this.backupRunModel.create({
      type,
      status: 'running',
      triggeredBy: user?._id,
      triggeredByEmail: user?.email ?? (source === 'cron' ? 'cron' : ''),
      jobId,
      storagePath: runDir,
      startedAt: new Date(),
    });

    void this.runBackupJob(
      user,
      jobId,
      String(run._id),
      type,
      runDir,
    ).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Backup job ${jobId} failed: ${msg}`);
      void this.adminJobEmitter?.emitFailed({ jobId, error: msg });
    });

    return { jobId, runId: String(run._id) };
  }

  private async lastCollectionCounts(): Promise<Map<string, number>> {
    const last = await this.backupRunModel
      .findOne({
        type: { $in: ['incremental', 'full'] },
        status: 'completed',
      })
      .sort({ completedAt: -1 })
      .exec();

    const map = new Map<string, number>();
    for (const col of last?.collections ?? []) {
      map.set(col.name, col.documentCount);
    }
    return map;
  }

  private async runBackupJob(
    user: UserModel | null,
    jobId: string,
    runDocId: string,
    type: 'incremental' | 'full',
    runDir: string,
  ): Promise<void> {
    try {
      const lastCounts =
        type === 'incremental' ? await this.lastCollectionCounts() : undefined;

      const result = await this.operations.exportBackup(
        type,
        runDir,
        async (pct, label, phase, meta) => {
          await this.adminJobEmitter?.emitProgress({
            jobId,
            pct,
            label,
            phase,
            current: meta?.current,
            total: meta?.total,
            documentsCopied: meta?.documentsCopied,
          });
        },
        lastCounts,
      );

      const now = new Date();
      await this.backupRunModel.findByIdAndUpdate(runDocId, {
        $set: {
          status: 'completed',
          collections: result.collections,
          sizeBytes: result.sizeBytes,
          completedAt: now,
        },
      });

      const settingsPatch: Record<string, Date> = {};
      if (type === 'incremental') {
        settingsPatch.lastIncrementalBackupAt = now;
      } else {
        settingsPatch.lastFullBackupAt = now;
        settingsPatch.lastIncrementalBackupAt = now;
      }
      await this.settingsModel.updateOne(
        { key: SETTINGS_KEY },
        { $set: settingsPatch },
      );

      await this.adminJobEmitter?.emitCompleted({
        jobId,
        result: {
          type,
          runId: runDocId,
          collections: result.collections.length,
          sizeBytes: result.sizeBytes,
        },
      });

      this.logger.log(
        `DB backup (${type}) by ${user?.email ?? 'cron'}: ${result.collections.length} collection(s), ${result.sizeBytes} bytes`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.backupRunModel.findByIdAndUpdate(runDocId, {
        $set: {
          status: 'failed',
          errorMessage: msg,
          completedAt: new Date(),
        },
      });
      await this.adminJobEmitter?.emitFailed({ jobId, error: msg });
      throw error;
    }
  }

  private async runMigrationJob(
    user: UserModel,
    jobId: string,
    runDocId: string,
    targetUri: string,
    dropTargetCollections: boolean,
  ): Promise<void> {
    try {
      const result = await this.operations.migrateToTarget(
        targetUri,
        dropTargetCollections,
        async (pct, label, phase, meta) => {
          await this.adminJobEmitter?.emitProgress({
            jobId,
            pct,
            label,
            phase,
            current: meta?.current,
            total: meta?.total,
            documentsCopied: meta?.documentsCopied,
          });
        },
      );

      await this.backupRunModel.findByIdAndUpdate(runDocId, {
        $set: {
          status: 'completed',
          collections: result.collections,
          completedAt: new Date(),
        },
      });

      await this.adminJobEmitter?.emitCompleted({
        jobId,
        result: {
          type: 'migration',
          runId: runDocId,
          collections: result.collections.length,
        },
      });

      this.logger.warn(
        `DB migration by ${user.email}: ${result.collections.length} collection(s) copied`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.backupRunModel.findByIdAndUpdate(runDocId, {
        $set: {
          status: 'failed',
          errorMessage: msg,
          completedAt: new Date(),
        },
      });
      await this.adminJobEmitter?.emitFailed({ jobId, error: msg });
      throw error;
    }
  }

  private async runRestoreJob(
    user: UserModel,
    jobId: string,
    runDocId: string,
    storagePath: string,
  ): Promise<void> {
    try {
      const result = await this.operations.restoreFromBackup(
        storagePath,
        async (pct, label, phase, meta) => {
          await this.adminJobEmitter?.emitProgress({
            jobId,
            pct,
            label,
            phase,
            current: meta?.current,
            total: meta?.total,
            documentsCopied: meta?.documentsCopied,
          });
        },
      );

      await this.backupRunModel.findByIdAndUpdate(runDocId, {
        $set: {
          status: 'completed',
          collections: result.collections,
          completedAt: new Date(),
        },
      });

      await this.adminJobEmitter?.emitCompleted({
        jobId,
        result: {
          type: 'restore',
          runId: runDocId,
          collections: result.collections.length,
        },
      });

      this.logger.warn(
        `DB restore by ${user.email}: ${result.collections.length} collection(s) restored from ${storagePath}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.backupRunModel.findByIdAndUpdate(runDocId, {
        $set: {
          status: 'failed',
          errorMessage: msg,
          completedAt: new Date(),
        },
      });
      await this.adminJobEmitter?.emitFailed({ jobId, error: msg });
      throw error;
    }
  }
}
