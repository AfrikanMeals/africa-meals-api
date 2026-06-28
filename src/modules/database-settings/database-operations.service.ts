import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import {
  DatabaseBackupCollectionMeta,
  DatabaseOperationType,
} from '@schemas/database-backup-run.schema';
import { createWriteStream, promises as fs } from 'fs';
import { Connection } from 'mongoose';
import { Collection, MongoClient } from 'mongodb';
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

type ProgressMeta = {
  current?: number;
  total?: number;
  documentsCopied?: number;
  indexesCopied?: number;
};

type ProgressCb = (
  pct: number,
  label: string,
  phase?: string,
  meta?: ProgressMeta,
) => Promise<void>;

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

  /** Recrée sur la cible les index de la source (hors `_id_`). */
  private async copyCollectionIndexes(
    sourceCol: Collection,
    targetCol: Collection,
  ): Promise<number> {
    let sourceIndexes: Awaited<ReturnType<Collection['indexes']>>;
    try {
      sourceIndexes = await sourceCol.indexes();
    } catch {
      return 0;
    }

    const toCreate = sourceIndexes.filter(
      (idx) => idx.name && idx.name !== '_id_',
    );
    if (toCreate.length === 0) return 0;

    try {
      const targetIndexes = await targetCol.indexes();
      for (const idx of targetIndexes) {
        if (idx.name && idx.name !== '_id_') {
          await targetCol.dropIndex(idx.name).catch(() => undefined);
        }
      }
    } catch {
      /* collection absente ou sans index secondaires */
    }

    let created = 0;
    for (const idx of toCreate) {
      const { key, v: _v, ns: _ns, ...options } = idx;
      if (!key || typeof key !== 'object') continue;
      try {
        await targetCol.createIndex(key, options);
        created++;
      } catch (error) {
        this.logger.warn(
          `Index ${idx.name ?? '?'} sur ${sourceCol.collectionName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return created;
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
    migrateIndexes: boolean,
    onProgress?: ProgressCb,
  ): Promise<{ collections: DatabaseBackupCollectionMeta[] }> {
    const sourceDb = this.connection.db;
    if (!sourceDb) {
      throw new Error('database_unavailable');
    }

    await onProgress?.(0, 'Connexion à la cible…', 'connecting');

    const client = new MongoClient(targetUri, {
      serverSelectionTimeoutMS: 30_000,
    });

    try {
      await client.connect();
      const sourceDbName = sourceDb.databaseName;
      const uriDbName = client.db().databaseName;
      const targetDbName =
        uriDbName && !['admin', 'local', 'config'].includes(uriDbName)
          ? uriDbName
          : sourceDbName;
      const targetDb = client.db(targetDbName);
      const hostPart = summarizeMongoUri(targetUri).replace(/\/[^/]+$/, '');
      const targetSummary = `${hostPart}/${targetDbName}`;

      const names = await this.listUserCollections();
      const total = names.length;
      const copied: DatabaseBackupCollectionMeta[] = [];

      if (total === 0) {
        await onProgress?.(
          100,
          'Aucune collection à migrer (source vide)',
          'done',
          { current: 0, total: 0, documentsCopied: 0 },
        );
        return { collections: copied };
      }

      const preparingLabel =
        targetDbName !== sourceDbName
          ? `${total} collection(s) · ${sourceDbName} → ${targetDbName}`
          : `${total} collection(s) · connexion OK (${targetSummary})`;

      await onProgress?.(2, preparingLabel, 'preparing', {
        current: 0,
        total,
        documentsCopied: 0,
      });

      let documentsCopied = 0;
      let indexesCopied = 0;

      for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        await onProgress?.(
          Math.max(3, Math.round((i / total) * 100)),
          dropTargetCollections
            ? `Copie ${name} (vidage cible)`
            : `Copie ${name}`,
          name,
          { current: i + 1, total, documentsCopied, indexesCopied },
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
            documentsCopied += batch.length;
            batch = [];
            if (documentCount % (BATCH_SIZE * 4) === 0) {
              await onProgress?.(
                Math.round(((i + 0.5) / total) * 100),
                `Copie ${name} (${documentCount.toLocaleString('fr-FR')} docs)`,
                name,
                { current: i + 1, total, documentsCopied, indexesCopied },
              );
            }
          }
        }
        if (batch.length) {
          await targetCol.insertMany(batch, { ordered: false });
          documentCount += batch.length;
          documentsCopied += batch.length;
        }

        if (migrateIndexes) {
          await onProgress?.(
            Math.round(((i + 0.85) / total) * 100),
            `Index ${name}`,
            `${name}:indexes`,
            { current: i + 1, total, documentsCopied, indexesCopied },
          );
          indexesCopied += await this.copyCollectionIndexes(sourceCol, targetCol);
        }

        copied.push({ name, documentCount, fileName: '' });
        const copiedLabel = migrateIndexes
          ? `Copié ${name} (${documentCount.toLocaleString('fr-FR')} docs · index)`
          : `Copié ${name} (${documentCount.toLocaleString('fr-FR')} docs)`;
        await onProgress?.(
          Math.round(((i + 1) / total) * 100),
          copiedLabel,
          name,
          { current: i + 1, total, documentsCopied, indexesCopied },
        );
      }

      const doneLabel = migrateIndexes
        ? `Migration terminée · ${total} collection(s) · ${documentsCopied.toLocaleString('fr-FR')} document(s) · ${indexesCopied.toLocaleString('fr-FR')} index`
        : `Migration terminée · ${total} collection(s) · ${documentsCopied.toLocaleString('fr-FR')} document(s)`;
      await onProgress?.(
        100,
        doneLabel,
        'done',
        { current: total, total, documentsCopied, indexesCopied },
      );
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
