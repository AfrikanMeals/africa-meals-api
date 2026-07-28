import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { AdminJobEmitterService } from '@modules/admin-jobs/admin-job-emitter.service';
import { AdminJobProgressService } from '@modules/admin-jobs/admin-job-progress.service';
import { MediasService } from '@modules/medias/medias.service';
import { StorageEngineFactory } from '@modules/medias/storage-engine.factory';
import {
  detectEngineFromUrl,
  extractObjectPath,
  isStorageObjectNotFoundError,
  StorageUploadResult,
} from '@modules/medias/storage-engine.types';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { StorageEngineId } from '@schemas/storage-settings.schema';
import {
  StorageTransferRunDocument,
  StorageTransferRunModel,
  StorageTransferStatsModel,
} from '@schemas/storage-transfer-run.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { randomUUID } from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import { TriggerStorageTransferDto } from './dto/trigger-storage-transfer.dto';
import { StorageSettingsService } from './storage-settings.service';
import {
  STORAGE_MEDIA_TARGETS,
  StorageMediaArrayField,
  StorageMediaScalarField,
} from './storage-media-inventory.constants';

type TransferWorkItem = {
  collection: string;
  docId: Types.ObjectId;
  setFields: (newUrl: string) => Record<string, unknown>;
  url: string;
  objectPath: string;
};

@Injectable()
export class StorageTransferService {
  private readonly logger = new Logger(StorageTransferService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StorageTransferRunModel.name)
    private readonly runModel: Model<StorageTransferRunDocument>,
    private readonly storageSettings: StorageSettingsService,
    private readonly engineFactory: StorageEngineFactory,
    private readonly medias: MediasService,
    private readonly storeAccess: StoreAccessService,
    @Inject(forwardRef(() => AdminJobEmitterService))
    @Optional()
    private readonly adminJobEmitter?: AdminJobEmitterService,
    @Inject(forwardRef(() => AdminJobProgressService))
    @Optional()
    private readonly adminJobProgress?: AdminJobProgressService,
  ) {}

  private async assertAdmin(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  async getJobProgress(user: UserModel, jobId: string) {
    await this.assertAdmin(user);
    const id = jobId.trim();
    if (!id) throw new BadRequestException('job_id_required');

    const snap = this.adminJobProgress?.getSnapshot(id);
    if (snap && snap.label !== 'idle') {
      return {
        jobId: id,
        pct: snap.pct,
        label: snap.label,
        phase: snap.phase,
        running: snap.running,
        current: snap.current,
        total: snap.total,
        documentsCopied: snap.documentsCopied,
      };
    }

    const run = await this.runModel.findOne({ jobId: id }).exec();
    if (!run) throw new NotFoundException('job_not_found');

    if (run.status === 'completed') {
      return {
        jobId: id,
        pct: 100,
        label: 'Transfert terminé',
        phase: 'complete',
        running: false,
        documentsCopied: run.stats?.transferred ?? 0,
      };
    }
    if (run.status === 'failed') {
      return {
        jobId: id,
        pct: 0,
        label: run.errorMessage?.trim() || 'Erreur',
        phase: 'error',
        running: false,
      };
    }
    return {
      jobId: id,
      pct: 0,
      label: 'Transfert en cours…',
      phase: 'running',
      running: true,
    };
  }

  async triggerTransferAsync(
    user: UserModel,
    dto: TriggerStorageTransferDto,
  ): Promise<{ jobId: string; runId: string }> {
    await this.assertAdmin(user);
    if (dto.sourceEngine === dto.targetEngine) {
      throw new BadRequestException('storage_transfer_same_engine');
    }

    const settings = await this.storageSettings.getPublicSettings();
    if (settings.enginesEnabled[dto.sourceEngine] === false) {
      throw new BadRequestException('storage_transfer_source_disabled');
    }
    if (settings.enginesEnabled[dto.targetEngine] === false) {
      throw new BadRequestException('storage_transfer_target_disabled');
    }
    const source = this.engineFactory.byId(dto.sourceEngine);
    const target = this.engineFactory.byId(dto.targetEngine);
    if (!source.isConfigured() || !target.isConfigured()) {
      throw new BadRequestException('storage_transfer_engine_not_configured');
    }

    const jobId = randomUUID();
    const run = await this.runModel.create({
      sourceEngine: dto.sourceEngine,
      targetEngine: dto.targetEngine,
      overrideExisting: dto.overrideExisting === true,
      dryRun: dto.dryRun === true,
      status: 'running',
      triggeredBy: user._id,
      triggeredByEmail: user.email ?? '',
      jobId,
      stats: {},
      startedAt: new Date(),
    });

    await this.adminJobEmitter?.emitProgress({
      jobId,
      pct: 0,
      label: dto.dryRun ? 'Inventaire démarré…' : 'Transfert démarré…',
      phase: 'starting',
    });

    void this.runTransferJob(user, jobId, String(run._id), dto).catch(
      (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Storage transfer ${jobId} failed: ${msg}`);
        void this.adminJobEmitter?.emitFailed({ jobId, error: msg });
      },
    );

    return { jobId, runId: String(run._id) };
  }

  private async runTransferJob(
    user: UserModel,
    jobId: string,
    runDocId: string,
    dto: TriggerStorageTransferDto,
  ): Promise<void> {
    const stats: StorageTransferStatsModel = {
      scanned: 0,
      transferred: 0,
      skipped: 0,
      failed: 0,
      dbUpdated: 0,
    };

    const report = async (
      pct: number,
      label: string,
      phase: string,
      meta?: { current?: number; total?: number },
    ) => {
      await this.adminJobEmitter?.emitProgress({
        jobId,
        pct,
        label,
        phase,
        current: meta?.current,
        total: meta?.total,
        documentsCopied: stats.transferred,
      });
    };

    try {
      await report(2, 'Inventaire des médias…', 'scanning');
      const items = await this.collectWorkItems(dto.sourceEngine, dto.targetEngine);
      stats.scanned = items.length;
      const total = items.length || 1;

      if (dto.dryRun) {
        await report(
          100,
          `${items.length} fichier(s) éligibles (simulation)`,
          'complete',
          { current: items.length, total },
        );
        await this.runModel.findByIdAndUpdate(runDocId, {
          $set: { status: 'completed', stats, completedAt: new Date() },
        });
        await this.adminJobEmitter?.emitCompleted({
          jobId,
          result: {
            type: 'storage_transfer',
            dryRun: true,
            scanned: items.length,
          },
        });
        return;
      }

      const targetEngine = this.engineFactory.byId(dto.targetEngine);
      const sourceEngine = this.engineFactory.byId(dto.sourceEngine);
      const settings = await this.storageSettings.getPublicSettings();
      const overrideExisting = dto.overrideExisting === true;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const pct = Math.min(99, Math.round(5 + ((i + 1) / total) * 94));
        await report(
          pct,
          `Transfert ${i + 1}/${total} — ${item.collection}`,
          'copying',
          { current: i + 1, total },
        );

        try {
          const { objectPath } = item;
          if (!overrideExisting) {
            const detected = detectEngineFromUrl(item.url);
            if (detected === dto.targetEngine) {
              stats.skipped++;
              continue;
            }
            if (await this.objectExists(targetEngine, objectPath)) {
              stats.skipped++;
              continue;
            }
          }

          const payload = await this.readObjectPayload(
            item.url,
            objectPath,
            sourceEngine,
          );
          if (!payload) {
            stats.failed++;
            continue;
          }

          const uploadResult = await targetEngine.upload({
            buffer: payload.buffer,
            path: objectPath,
            contentType: payload.contentType,
            owner: user._id.toString(),
          });

          const newUrl = await this.resolvePublicUrl(
            uploadResult,
            settings.mediaProxyEnabled,
          );
          await this.connection.db
            .collection(item.collection)
            .updateOne({ _id: item.docId }, { $set: item.setFields(newUrl) });

          stats.transferred++;
          stats.dbUpdated++;
        } catch (err) {
          stats.failed++;
          this.logger.warn(
            `Storage transfer failed (${item.collection}/${String(item.docId)}): ${(err as Error).message}`,
          );
        }
      }

      await this.runModel.findByIdAndUpdate(runDocId, {
        $set: { status: 'completed', stats, completedAt: new Date() },
      });

      await report(
        100,
        `Terminé — ${stats.transferred} transféré(s), ${stats.skipped} ignoré(s), ${stats.failed} échec(s)`,
        'complete',
        { current: total, total },
      );

      await this.adminJobEmitter?.emitCompleted({
        jobId,
        result: {
          type: 'storage_transfer',
          transferred: stats.transferred,
          skipped: stats.skipped,
          failed: stats.failed,
          dbUpdated: stats.dbUpdated,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.runModel.findByIdAndUpdate(runDocId, {
        $set: {
          status: 'failed',
          stats,
          errorMessage: msg,
          completedAt: new Date(),
        },
      });
      await this.adminJobEmitter?.emitFailed({ jobId, error: msg });
      throw error;
    }
  }

  private async collectWorkItems(
    sourceEngine: StorageEngineId,
    targetEngine: StorageEngineId,
  ): Promise<TransferWorkItem[]> {
    const out: TransferWorkItem[] = [];

    for (const target of STORAGE_MEDIA_TARGETS) {
      const col = this.connection.db.collection(target.collection);
      const cursor = col.find({}, { projection: this.buildProjection(target.fields) });

      for await (const doc of cursor) {
        const docId = doc._id as Types.ObjectId;
        for (const field of target.fields) {
          if (field.kind === 'scalar') {
            this.pushScalarItem(
              out,
              target.collection,
              docId,
              field,
              doc,
              sourceEngine,
              targetEngine,
            );
          } else if (field.kind === 'stringArray') {
            this.pushStringArrayItems(
              out,
              target.collection,
              docId,
              field,
              doc,
              sourceEngine,
              targetEngine,
            );
          } else {
            this.pushArrayItems(
              out,
              target.collection,
              docId,
              field,
              doc,
              sourceEngine,
              targetEngine,
            );
          }
        }
      }
    }

    return out;
  }

  private buildProjection(
    fields: Array<StorageMediaScalarField | StorageMediaArrayField>,
  ): Record<string, 1> {
    const projection: Record<string, 1> = { _id: 1 };
    for (const field of fields) {
      if (field.kind === 'scalar') projection[field.field] = 1;
      else projection[field.arrayField] = 1;
    }
    return projection;
  }

  private pushScalarItem(
    out: TransferWorkItem[],
    collection: string,
    docId: Types.ObjectId,
    field: StorageMediaScalarField,
    doc: Record<string, unknown>,
    sourceEngine: StorageEngineId,
    targetEngine: StorageEngineId,
  ): void {
    const raw = doc[field.field];
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (!this.isTransferableUrl(url, sourceEngine, targetEngine)) return;
    out.push({
      collection,
      docId,
      url,
      objectPath: extractObjectPath(url),
      setFields: (newUrl) => ({ [field.field]: newUrl }),
    });
  }

  private pushArrayItems(
    out: TransferWorkItem[],
    collection: string,
    docId: Types.ObjectId,
    field: StorageMediaArrayField,
    doc: Record<string, unknown>,
    sourceEngine: StorageEngineId,
    targetEngine: StorageEngineId,
  ): void {
    const rows = doc[field.arrayField];
    if (!Array.isArray(rows)) return;
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object') return;
      const url = String((row as Record<string, unknown>)[field.urlField] ?? '').trim();
      if (!this.isTransferableUrl(url, sourceEngine, targetEngine)) return;
      out.push({
        collection,
        docId,
        url,
        objectPath: extractObjectPath(url),
        setFields: (newUrl) => ({
          [`${field.arrayField}.${index}.${field.urlField}`]: newUrl,
        }),
      });
    });
  }

  private isTransferableUrl(
    url: string,
    sourceEngine: StorageEngineId,
    targetEngine: StorageEngineId,
  ): boolean {
    if (!url) return false;
    if (url.startsWith('data:')) return true;
    if (!url.startsWith('http')) return false;
    const detected = detectEngineFromUrl(url);
    if (detected === targetEngine) return false;
    if (detected === sourceEngine) return true;
    if (detected === null && url.includes('/medias/public/')) return true;
    return false;
  }

  private async objectExists(
    engine: ReturnType<StorageEngineFactory['byId']>,
    objectPath: string,
  ): Promise<boolean> {
    try {
      const stream = await engine.readObject(objectPath);
      stream.body.resume();
      return true;
    } catch (err) {
      if (isStorageObjectNotFoundError(err)) return false;
      throw err;
    }
  }

  private async readObjectPayload(
    url: string,
    objectPath: string,
    sourceEngine: ReturnType<StorageEngineFactory['byId']>,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/i);
      if (!match) return null;
      return {
        contentType: match[1],
        buffer: Buffer.from(match[2], 'base64'),
      };
    }

    try {
      const fromSource = await sourceEngine.readObject(objectPath);
      return {
        buffer: await this.streamToBuffer(fromSource.body),
        contentType: fromSource.contentType ?? 'application/octet-stream',
      };
    } catch (sourceErr) {
      if (!url.includes('/medias/public/')) {
        if (isStorageObjectNotFoundError(sourceErr)) return null;
        throw sourceErr;
      }
    }

    try {
      const proxyStream = await this.medias.streamPublicObject(objectPath);
      return {
        buffer: await this.streamToBuffer(proxyStream.body),
        contentType: proxyStream.contentType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async resolvePublicUrl(
    result: StorageUploadResult,
    mediaProxyEnabled: boolean,
  ): Promise<string> {
    if (
      mediaProxyEnabled &&
      (result.engine === 'gcs' ||
        result.engine === 's3' ||
        result.engine === 'minio' ||
        result.engine === 'r2')
    ) {
      return this.medias.buildProxyPublicUrl(result.path);
    }
    return result.url;
  }
}
