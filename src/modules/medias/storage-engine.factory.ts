import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from 'firebase-admin/app';
import { StorageEngineMode, StorageEnginesEnabled } from '@schemas/storage-settings.schema';
import {
  detectEngineFromUrl,
  IStorageEngine,
  StorageEngineId,
} from './storage-engine.types';
import {
  FirebaseStorageEngine,
  GcsStorageEngine,
  MinioStorageEngine,
  R2StorageEngine,
  S3StorageEngine,
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

  resolve(
    mode: StorageEngineMode,
    enabled?: StorageEnginesEnabled,
  ): IStorageEngine {
    if (mode === 'auto') {
      const available = this.configuredAndAllowed(enabled);
      if (!available.length) {
        const fallback = this.engines.find((e) =>
          this.isEngineAllowed(e.id, enabled),
        );
        return fallback ?? this.byId('firebase');
      }
      return available[Math.floor(Math.random() * available.length)];
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

  /** Ordre de lecture proxy : moteur admin d’abord, puis les autres configurés et activés. */
  enginesToTryForRead(
    mode: StorageEngineMode,
    enabled?: StorageEnginesEnabled,
  ): IStorageEngine[] {
    const primary = this.resolve(mode, enabled);
    const seen = new Set<StorageEngineId>();
    const ordered: IStorageEngine[] = [];
    for (const engine of [
      primary,
      ...this.engines.filter(
        (e) =>
          e.id !== primary.id &&
          e.isConfigured() &&
          this.isEngineAllowed(e.id, enabled),
      ),
    ]) {
      if (seen.has(engine.id)) continue;
      seen.add(engine.id);
      ordered.push(engine);
    }
    return ordered;
  }
}
