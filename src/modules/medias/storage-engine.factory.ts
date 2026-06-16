import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { App } from 'firebase-admin/app';
import { StorageEngineMode } from '@schemas/storage-settings.schema';
import {
  detectEngineFromUrl,
  IStorageEngine,
  StorageEngineId,
} from './storage-engine.types';
import {
  FirebaseStorageEngine,
  GcsStorageEngine,
  S3StorageEngine,
} from './storage-engines';

@Injectable()
export class StorageEngineFactory {
  private readonly engines: IStorageEngine[];

  constructor(
    @Inject('FIREBASE_ADMIN') firebaseApp: App,
    @Inject('FIREBASE_STORAGE_BUCKET') bucketName: string,
    config: ConfigService,
  ) {
    this.engines = [
      new FirebaseStorageEngine(firebaseApp, bucketName),
      new GcsStorageEngine(config),
      new S3StorageEngine(config),
    ];
  }

  byId(id: StorageEngineId): IStorageEngine {
    const engine = this.engines.find((e) => e.id === id);
    if (!engine) {
      return this.engines[0];
    }
    return engine;
  }

  resolve(mode: StorageEngineMode): IStorageEngine {
    if (mode === 'auto') {
      const available = this.engines.filter((e) => e.isConfigured());
      if (!available.length) {
        return this.byId('firebase');
      }
      return available[Math.floor(Math.random() * available.length)];
    }
    const picked = this.byId(mode);
    if (picked.isConfigured()) return picked;
    const fallback = this.engines.find((e) => e.isConfigured());
    return fallback ?? picked;
  }

  resolveForDelete(pathOrUrl: string): IStorageEngine {
    const detected = detectEngineFromUrl(pathOrUrl);
    if (detected) {
      return this.byId(detected);
    }
    return this.byId('firebase');
  }

  /** Ordre de lecture proxy : moteur admin d’abord, puis les autres configurés. */
  enginesToTryForRead(mode: StorageEngineMode): IStorageEngine[] {
    const primary = this.resolve(mode);
    const seen = new Set<StorageEngineId>();
    const ordered: IStorageEngine[] = [];
    for (const engine of [
      primary,
      ...this.engines.filter((e) => e.id !== primary.id && e.isConfigured()),
    ]) {
      if (seen.has(engine.id)) continue;
      seen.add(engine.id);
      ordered.push(engine);
    }
    return ordered;
  }
}
