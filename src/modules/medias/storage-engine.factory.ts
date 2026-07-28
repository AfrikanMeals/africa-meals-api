import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from 'firebase-admin/app';
import { StorageEngineMode, StorageEnginesEnabled } from '@schemas/storage-settings.schema';
import {
  detectEngineFromUrl,
  IStorageEngine,
  StorageEngineId,
} from './storage-engine.types';
import { orderStorageEnginesForRead } from './storage-engine-read-order.util';
import {
  FirebaseStorageEngine,
  GcsStorageEngine,
  MinioStorageEngine,
  R2StorageEngine,
  S3StorageEngine,
  VercelBlobStorageEngine,
} from './storage-engines';

@Injectable()
export class StorageEngineFactory {
  private readonly engines: IStorageEngine[];

  constructor(
    @Optional() @Inject('FIREBASE_ADMIN') firebaseApp: App | null,
    @Inject('FIREBASE_STORAGE_BUCKET') bucketName: string,
    config: ConfigService,
  ) {
    this.engines = [
      ...(firebaseApp && bucketName
        ? [new FirebaseStorageEngine(firebaseApp, bucketName)]
        : []),
      new GcsStorageEngine(config),
      new S3StorageEngine(config),
      new MinioStorageEngine(config),
      new R2StorageEngine(config),
      new VercelBlobStorageEngine(config),
    ];
    if (!firebaseApp) {
      Logger.warn(
        'Moteur Firebase Storage indisponible (compte de service absent).',
        StorageEngineFactory.name,
      );
    }
  }

  byId(id: StorageEngineId): IStorageEngine {
    const engine = this.engines.find((e) => e.id === id);
    if (!engine) {
      const fallback = this.engines[0];
      if (!fallback) {
        throw new Error('Aucun moteur de stockage configuré');
      }
      return fallback;
    }
    return engine;
  }

  private isEngineAllowed(
    id: StorageEngineId,
    enabled?: StorageEnginesEnabled,
  ): boolean {
    if (!enabled) return true;
    return enabled[id] !== false;
  }

  private configuredAndAllowed(
    enabled?: StorageEnginesEnabled,
  ): IStorageEngine[] {
    return this.engines.filter(
      (e) => e.isConfigured() && this.isEngineAllowed(e.id, enabled),
    );
  }

  resolveFromPool(
    pool: StorageEngineId[] | undefined,
    enabled?: StorageEnginesEnabled,
  ): IStorageEngine {
    const candidateIds =
      pool?.length && pool.length > 0
        ? pool
        : ([
            'firebase',
            'gcs',
            's3',
            'minio',
            'r2',
            'vercelBlob',
          ] as StorageEngineId[]);
    const available = candidateIds
      .filter((id) => this.isEngineAllowed(id, enabled))
      .map((id) => this.byId(id))
      .filter((e) => e.isConfigured());
    if (!available.length) {
      const fallback = this.configuredAndAllowed(enabled)[0];
      return fallback ?? this.byId('firebase');
    }
    if (available.length === 1) return available[0];
    return available[Math.floor(Math.random() * available.length)];
  }

  resolve(
    mode: StorageEngineMode,
    enabled?: StorageEnginesEnabled,
    pool?: StorageEngineId[],
  ): IStorageEngine {
    if (mode === 'auto') {
      return this.resolveFromPool(pool, enabled);
    }
    if (!this.isEngineAllowed(mode, enabled)) {
      const available = this.configuredAndAllowed(enabled);
      if (available.length) return available[0];
      return this.byId(mode);
    }
    const picked = this.byId(mode);
    if (picked.isConfigured()) return picked;
    const fallback = this.configuredAndAllowed(enabled)[0];
    return fallback ?? picked;
  }

  resolveForDelete(pathOrUrl: string): IStorageEngine {
    const detected = detectEngineFromUrl(pathOrUrl);
    if (detected) {
      return this.byId(detected);
    }
    return this.byId('firebase');
  }

  /** Chaîne d’upload : primaire, repli admin, pool, puis autres moteurs configurés. */
  enginesToTryForUpload(
    primary: IStorageEngine,
    settings: {
      fallbackStorageEngine: StorageEngineId | null;
      enginesEnabled?: StorageEnginesEnabled;
      storageEnginePool?: StorageEngineId[];
    },
  ): IStorageEngine[] {
    const { fallbackStorageEngine, enginesEnabled, storageEnginePool } =
      settings;
    const priorityIds: StorageEngineId[] = [primary.id];
    if (fallbackStorageEngine && fallbackStorageEngine !== primary.id) {
      priorityIds.push(fallbackStorageEngine);
    }
    for (const id of storageEnginePool ?? []) {
      if (!priorityIds.includes(id)) priorityIds.push(id);
    }

    const seen = new Set<StorageEngineId>();
    const chain: IStorageEngine[] = [];
    const push = (engine: IStorageEngine) => {
      if (seen.has(engine.id)) return;
      if (!this.isEngineAllowed(engine.id, enginesEnabled)) return;
      if (!engine.isConfigured()) return;
      seen.add(engine.id);
      chain.push(engine);
    };

    for (const id of priorityIds) {
      push(this.byId(id));
    }
    for (const engine of this.engines) {
      push(engine);
    }
    return chain.length > 0 ? chain : [primary];
  }

  /**
   * Ordre de lecture proxy : primaire → pool → Firebase/GCS/S3/R2 → MinIO.
   * Garantit que GCS / R2 / Firebase restent essayés même si MinIO est primaire.
   */
  enginesToTryForRead(
    mode: StorageEngineMode,
    enabled?: StorageEnginesEnabled,
    pool?: StorageEngineId[],
  ): IStorageEngine[] {
    const primary = this.resolve(mode, enabled, pool);
    const candidates = this.configuredAndAllowed(enabled);
    const orderedIds = orderStorageEnginesForRead({
      primaryId: primary.id,
      pool,
      candidateIds: candidates.map((e) => e.id),
    });
    const byId = new Map(candidates.map((e) => [e.id, e] as const));
    return orderedIds
      .map((id) => byId.get(id))
      .filter((e): e is IStorageEngine => Boolean(e));
  }
}
