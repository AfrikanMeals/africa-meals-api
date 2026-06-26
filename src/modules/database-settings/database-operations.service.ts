import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import {
  DatabaseBackupCollectionMeta,
  DatabaseOperationType,
} from '@schemas/database-backup-run.schema';
import { createWriteStream, promises as fs } from 'fs';
import { Connection } from 'mongoose';
import { MongoClient } from 'mongodb';
import * as path from 'path';
import { EJSON } from 'bson';
import { summarizeMongoUri } from './database-uri.util';

const BATCH_SIZE = 500;
const SYSTEM_PREFIX = 'system.';

export type DatabaseConnectionTestResult = {
  ok: boolean;
  target: 'current' | 'custom';
  latencyMs: number;
  databaseName: string;
  hostSummary: string;
  serverVersion: string | null;
  collectionCount: number;
  readyState: number | null;
  errorMessage: string;
  testedAt: string;
};

type ProgressCb = (pct: number, label: string, phase?: string) => Promise<void>;

@Injectable()
export class DatabaseOperationsService {
  private readonly logger = new Logger(DatabaseOperationsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
  ) {}

  backupRootDir(): string {
    const raw = String(
      this.config.get<string>('DB_BACKUP_DIR') ??
        path.join(process.cwd(), 'data', 'db-backups'),
    ).trim();
    return path.resolve(raw);
  }

  private async listUserCollections(): Promise<string[]> {
    const db = this.connection.db;
    if (!db) return [];
    const rows = await db.listCollections().toArray();
    return rows
      .map((r) => r.name)
      .filter((name) => name && !name.startsWith(SYSTEM_PREFIX))
      .sort();
  }

  private async collectionDocumentCount(name: string): Promise<number> {
    const db = this.connection.db;
    if (!db) return 0;
    return db.collection(name).countDocuments();
  }

  async exportBackup(
    type: 'incremental' | 'full',
    runDir: string,
    onProgress?: ProgressCb,
    lastCounts?: Map<string, number>,
  ): Promise<{ collections: DatabaseBackupCollectionMeta[]; sizeBytes: number }> {
    const db = this.connection.db;
    if (!db) {
      throw new Error('database_unavailable');
    }

    await fs.mkdir(runDir, { recursive: true });
    const allNames = await this.listUserCollections();

    const resolvedNames: string[] = [];
    for (const name of allNames) {
      if (type === 'full') {
        resolvedNames.push(name);
        continue;
      }
      const count = await this.collectionDocumentCount(name);
      const prev = lastCounts?.get(name);
      if (prev == null || prev !== count) {
        resolvedNames.push(name);
      }
    }

    const collections: DatabaseBackupCollectionMeta[] = [];
    const total = Math.max(resolvedNames.length, 1);

    for (let i = 0; i < resolvedNames.length; i++) {
      const name = resolvedNames[i]!;
      await onProgress?.(
        Math.round((i / total) * 100),
        `Export ${name}`,
        name,
      );

      const fileName = `${name}.jsonl`;
      const filePath = path.join(runDir, fileName);
      let documentCount = 0;

      const cursor = db.collection(name).find({});
      const stream = createWriteStream(filePath, { encoding: 'utf8' });
      for await (const doc of cursor) {
        stream.write(`${EJSON.stringify(doc, { relaxed: false })}\n`);
        documentCount++;
      }
      await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on('error', reject);
      });

      collections.push({ name, documentCount, fileName });
    }

    const manifest = {
      type,
      exportedAt: new Date().toISOString(),
      collections,
    };
    await fs.writeFile(
      path.join(runDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );

    const sizeBytes = await this.directorySize(runDir);
    await onProgress?.(100, 'Export terminé', 'done');
    return { collections, sizeBytes };
  }

  async restoreFromBackup(
    runDir: string,
    onProgress?: ProgressCb,
  ): Promise<{ collections: DatabaseBackupCollectionMeta[] }> {
    const db = this.connection.db;
    if (!db) {
      throw new Error('database_unavailable');
    }

    const manifestPath = path.join(runDir, 'manifest.json');
    const manifestRaw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as {
      collections: DatabaseBackupCollectionMeta[];
    };
    const entries = manifest.collections ?? [];
    const total = Math.max(entries.length, 1);
    const restored: DatabaseBackupCollectionMeta[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      await onProgress?.(
        Math.round((i / total) * 100),
        `Restauration ${entry.name}`,
        entry.name,
      );

      const filePath = path.join(runDir, entry.fileName);
      const raw = await fs.readFile(filePath, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      const col = db.collection(entry.name);
      await col.deleteMany({});

      let inserted = 0;
      for (let offset = 0; offset < lines.length; offset += BATCH_SIZE) {
        const batchLines = lines.slice(offset, offset + BATCH_SIZE);
        const docs = batchLines.map(
          (line) => EJSON.parse(line) as Record<string, unknown>,
        );
        if (docs.length) {
          await col.insertMany(docs, { ordered: false });
          inserted += docs.length;
        }
      }

      restored.push({
        name: entry.name,
        documentCount: inserted,
        fileName: entry.fileName,
      });
    }

    await onProgress?.(100, 'Restauration terminée', 'done');
    return { collections: restored };
  }

  async migrateToTarget(
    targetUri: string,
    dropTargetCollections: boolean,
    onProgress?: ProgressCb,
  ): Promise<{ collections: DatabaseBackupCollectionMeta[] }> {
    const sourceDb = this.connection.db;
    if (!sourceDb) {
      throw new Error('database_unavailable');
    }

    const client = new MongoClient(targetUri, {
      serverSelectionTimeoutMS: 15_000,
    });

    try {
      await client.connect();
      const targetDb = client.db();

      const names = await this.listUserCollections();
      const total = Math.max(names.length, 1);
      const copied: DatabaseBackupCollectionMeta[] = [];

      for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        await onProgress?.(
          Math.round((i / total) * 100),
          `Copie ${name}`,
          name,
        );

        const sourceCol = sourceDb.collection(name);
        const targetCol = targetDb.collection(name);
        if (dropTargetCollections) {
          await targetCol.deleteMany({});
        }

        let documentCount = 0;
        const cursor = sourceCol.find({});
        let batch: Record<string, unknown>[] = [];

        for await (const doc of cursor) {
          batch.push(doc as Record<string, unknown>);
          if (batch.length >= BATCH_SIZE) {
            await targetCol.insertMany(batch, { ordered: false });
            documentCount += batch.length;
            batch = [];
          }
        }
        if (batch.length) {
          await targetCol.insertMany(batch, { ordered: false });
          documentCount += batch.length;
        }

        copied.push({ name, documentCount, fileName: '' });
      }

      await onProgress?.(100, 'Migration terminée', 'done');
      return { collections: copied };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async purgeExpiredBackups(retentionDays: number): Promise<number> {
    const root = this.backupRootDir();
    let removed = 0;
    const cutoff = Date.now() - retentionDays * 86_400_000;

    for (const sub of ['incremental', 'full']) {
      const dir = path.join(root, sub);
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const full = path.join(dir, entry.name);
          const stat = await fs.stat(full);
          if (stat.mtimeMs < cutoff) {
            await fs.rm(full, { recursive: true, force: true });
            removed++;
          }
        }
      } catch {
        /* absent */
      }
    }
    return removed;
  }

  resolveRunDir(type: DatabaseOperationType, runId: string): string {
    const folder =
      type === 'incremental'
        ? 'incremental'
        : type === 'full'
          ? 'full'
          : type === 'restore'
            ? 'restore'
            : 'migration';
    return path.join(this.backupRootDir(), folder, runId);
  }

  currentDatabaseSummary(): string {
    const uri = String(
      this.config.get<string>('MONGODB_URI') ??
        this.config.get<string>('MONGO_URI') ??
        '',
    ).trim();
    if (uri) {
      return summarizeMongoUri(uri);
    }
    const host = String(this.config.get<string>('DB_HOST') ?? 'localhost').trim();
    const database = String(
      this.config.get<string>('DB_NAME') ??
        this.connection.name ??
        'unknown',
    ).trim();
    const port = this.config.get<number>('DB_PORT') ?? 27017;
    return `${host}:${port}/${database}`;
  }

  async testConnection(
    targetUri?: string,
  ): Promise<DatabaseConnectionTestResult> {
    const startedAt = Date.now();
    const testedAt = new Date().toISOString();

    if (targetUri) {
      const client = new MongoClient(targetUri, {
        serverSelectionTimeoutMS: 10_000,
      });
      try {
        await client.connect();
        const db = client.db();
        const pingRes = (await db.admin().ping()) as { ok?: number };
        const ok = Number(pingRes?.ok ?? 0) === 1;
        const collections = await db.listCollections().toArray();
        const collectionCount = collections.filter(
          (c) => c.name && !c.name.startsWith(SYSTEM_PREFIX),
        ).length;
        let serverVersion: string | null = null;
        try {
          const buildInfo = (await db.admin().command({ buildInfo: 1 })) as {
            version?: string;
          };
          serverVersion = buildInfo?.version ?? null;
        } catch {
          /* optional */
        }
        return {
          ok,
          target: 'custom',
          latencyMs: Date.now() - startedAt,
          databaseName: db.databaseName,
          hostSummary: summarizeMongoUri(targetUri),
          serverVersion,
          collectionCount,
          readyState: null,
          errorMessage: ok ? '' : 'ping_failed',
          testedAt,
        };
      } catch (error) {
        return {
          ok: false,
          target: 'custom',
          latencyMs: Date.now() - startedAt,
          databaseName: '',
          hostSummary: summarizeMongoUri(targetUri),
          serverVersion: null,
          collectionCount: 0,
          readyState: null,
          errorMessage: error instanceof Error ? error.message : String(error),
          testedAt,
        };
      } finally {
        await client.close().catch(() => undefined);
      }
    }

    const db = this.connection.db;
    if (!db) {
      return {
        ok: false,
        target: 'current',
        latencyMs: Date.now() - startedAt,
        databaseName: '',
        hostSummary: this.currentDatabaseSummary(),
        serverVersion: null,
        collectionCount: 0,
        readyState: this.connection.readyState,
        errorMessage: 'database_unavailable',
        testedAt,
      };
    }

    try {
      const pingRes = (await db.admin().ping()) as { ok?: number };
      const ok = Number(pingRes?.ok ?? 0) === 1;
      const collections = await db.listCollections().toArray();
      const collectionCount = collections.filter(
        (c) => c.name && !c.name.startsWith(SYSTEM_PREFIX),
      ).length;
      let serverVersion: string | null = null;
      try {
        const buildInfo = (await db.admin().command({ buildInfo: 1 })) as {
          version?: string;
        };
        serverVersion = buildInfo?.version ?? null;
      } catch {
        /* optional */
      }
      return {
        ok,
        target: 'current',
        latencyMs: Date.now() - startedAt,
        databaseName: db.databaseName,
        hostSummary: this.currentDatabaseSummary(),
        serverVersion,
        collectionCount,
        readyState: this.connection.readyState,
        errorMessage: ok ? '' : 'ping_failed',
        testedAt,
      };
    } catch (error) {
      return {
        ok: false,
        target: 'current',
        latencyMs: Date.now() - startedAt,
        databaseName: db.databaseName,
        hostSummary: this.currentDatabaseSummary(),
        serverVersion: null,
        collectionCount: 0,
        readyState: this.connection.readyState,
        errorMessage: error instanceof Error ? error.message : String(error),
        testedAt,
      };
    }
  }

  private async directorySize(dir: string): Promise<number> {
    let total = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await this.directorySize(full);
      } else {
        const stat = await fs.stat(full);
        total += stat.size;
      }
    }
    return total;
  }
}
