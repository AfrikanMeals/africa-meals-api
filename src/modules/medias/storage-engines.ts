import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadFirebaseServiceAccount } from 'src/config/firebase-env';
import { App } from 'firebase-admin/app';
import { getDownloadURL, getStorage } from 'firebase-admin/storage';
import {
  extractObjectPath,
  IStorageEngine,
  StorageEngineId,
  StorageObjectStream,
  StorageUploadInput,
  StorageUploadResult,
} from './storage-engine.types';
import {
  buildMinioS3ClientConfig,
  normalizeMinioEndpoint,
  parseMinioEndpoints,
} from './minio-endpoints.util';
import {
  isObjectAclUnsupportedError,
  storageObjectAclEnabled,
} from './storage-object-acl.util';

@Injectable()
export class FirebaseStorageEngine implements IStorageEngine {
  readonly id: StorageEngineId = 'firebase';
  private readonly logger = new Logger(FirebaseStorageEngine.name);

  constructor(
    private readonly firebaseApp: App,
    private readonly bucketName: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.bucketName?.trim());
  }

  private get bucket() {
    return getStorage(this.firebaseApp).bucket(this.bucketName);
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const fileRef = this.bucket.file(input.path);
    await fileRef.save(input.buffer, {
      metadata: {
        contentType: input.contentType,
        metadata: { owner: input.owner },
      },
    });
    const url = await getDownloadURL(fileRef);
    return { url, path: input.path, engine: this.id };
  }

  async readObject(objectPath: string): Promise<StorageObjectStream> {
    const fileRef = this.bucket.file(objectPath);
    const [exists] = await fileRef.exists();
    if (!exists) {
      throw new Error(`No such object: ${this.bucketName}/${objectPath}`);
    }
    const [meta] = await fileRef.getMetadata();
    const contentType =
      typeof meta?.contentType === 'string' ? meta.contentType : undefined;
    return { body: fileRef.createReadStream(), contentType };
  }

  async delete(pathOrUrl: string): Promise<void> {
    const path = extractObjectPath(pathOrUrl);
    await this.bucket.file(path).delete();
  }

  async deleteFilesWithPrefix(prefix: string): Promise<void> {
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const [files] = await this.bucket.getFiles({ prefix: normalized });
      await Promise.all(
        files.map((f) =>
          f.delete().catch((err: Error) => {
            this.logger.warn(`skip delete ${f.name}: ${err.message}`);
          }),
        ),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefix', err);
    }
  }

  async deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void> {
    const keepPath = extractObjectPath(keepPathOrUrl);
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const [files] = await this.bucket.getFiles({ prefix: normalized });
      await Promise.all(
        files
          .filter((f) => f.name !== keepPath)
          .map((f) =>
            f.delete().catch((err: Error) => {
              this.logger.warn(`skip delete ${f.name}: ${err.message}`);
            }),
          ),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefixExcept', err);
    }
  }
}

@Injectable()
export class GcsStorageEngine implements IStorageEngine {
  readonly id: StorageEngineId = 'gcs';
  private readonly logger = new Logger(GcsStorageEngine.name);
  private storageClient: import('@google-cloud/storage').Storage | null = null;
  private objectAclUnsupported = false;

  constructor(private readonly config: ConfigService) {}

  private bucketName(): string {
    return (
      this.config.get<string>('GCS_BUCKET')?.trim() ||
      this.config.get<string>('GOOGLE_CLOUD_STORAGE_BUCKET')?.trim() ||
      this.config.get<string>('AM_FIREBASE_STORAGE_BUCKET')?.trim() ||
      ''
    );
  }

  isConfigured(): boolean {
    return Boolean(this.bucketName());
  }

  private async client() {
    if (!this.storageClient) {
      const { Storage } = await import('@google-cloud/storage');
      const sa = loadFirebaseServiceAccount(this.config);
      const clientEmail = String(sa?.client_email ?? '').trim();
      const privateKey = String(sa?.private_key ?? '').trim();
      const projectId = String(sa?.project_id ?? '').trim();
      if (clientEmail && privateKey) {
        this.storageClient = new Storage({
          ...(projectId ? { projectId } : {}),
          credentials: {
            client_email: clientEmail,
            private_key: privateKey.replace(/\\n/g, '\n'),
          },
        });
      } else {
        this.storageClient = new Storage();
      }
    }
    return this.storageClient;
  }

  private publicUrl(bucket: string, path: string): string {
    const encoded = path
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    return `https://storage.googleapis.com/${bucket}/${encoded}`;
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const bucket = this.bucketName();
    const storage = await this.client();
    const file = storage.bucket(bucket).file(input.path);
    await file.save(input.buffer, {
      contentType: input.contentType,
      metadata: { metadata: { owner: input.owner } },
    });

    if (
      !this.objectAclUnsupported &&
      storageObjectAclEnabled(this.config, 'GCS_PUBLIC_READ')
    ) {
      try {
        await file.makePublic();
      } catch (err) {
        if (isObjectAclUnsupportedError(err)) {
          this.objectAclUnsupported = true;
          this.logger.debug(
            `GCS makePublic indisponible (UBLA / IAM bucket) — uploads sans ACL objet`,
          );
        } else {
          this.logger.warn(
            `GCS makePublic skipped for gs://${bucket}/${input.path}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    return {
      url: this.publicUrl(bucket, input.path),
      path: input.path,
      engine: this.id,
    };
  }

  async readObject(objectPath: string): Promise<StorageObjectStream> {
    const bucket = this.bucketName();
    const storage = await this.client();
    const file = storage.bucket(bucket).file(objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`No such object: ${bucket}/${objectPath}`);
    }
    const [meta] = await file.getMetadata();
    const contentType =
      typeof meta?.contentType === 'string' ? meta.contentType : undefined;
    return { body: file.createReadStream(), contentType };
  }

  async delete(pathOrUrl: string): Promise<void> {
    const bucket = this.bucketName();
    const storage = await this.client();
    await storage.bucket(bucket).file(extractObjectPath(pathOrUrl)).delete();
  }

  async deleteFilesWithPrefix(prefix: string): Promise<void> {
    const bucket = this.bucketName();
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const storage = await this.client();
      const [files] = await storage.bucket(bucket).getFiles({ prefix: normalized });
      await Promise.all(
        files.map((f) =>
          f.delete().catch((err: Error) => {
            this.logger.warn(`skip delete ${f.name}: ${err.message}`);
          }),
        ),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefix', err);
    }
  }

  async deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void> {
    const keepPath = extractObjectPath(keepPathOrUrl);
    const bucket = this.bucketName();
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const storage = await this.client();
      const [files] = await storage.bucket(bucket).getFiles({ prefix: normalized });
      await Promise.all(
        files
          .filter((f) => f.name !== keepPath)
          .map((f) =>
            f.delete().catch((err: Error) => {
              this.logger.warn(`skip delete ${f.name}: ${err.message}`);
            }),
          ),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefixExcept', err);
    }
  }
}

@Injectable()
export class S3StorageEngine implements IStorageEngine {
  readonly id: StorageEngineId = 's3';
  private readonly logger = new Logger(S3StorageEngine.name);
  private s3Client: import('@aws-sdk/client-s3').S3Client | null = null;
  private objectAclUnsupported = false;

  constructor(private readonly config: ConfigService) {}

  private bucket(): string {
    return this.config.get<string>('AWS_S3_BUCKET')?.trim() || '';
  }

  private region(): string {
    return this.config.get<string>('AWS_REGION')?.trim() || 'us-east-1';
  }

  isConfigured(): boolean {
    const bucket = this.bucket();
    const key = this.config.get<string>('AWS_ACCESS_KEY_ID')?.trim();
    const secret = this.config.get<string>('AWS_SECRET_ACCESS_KEY')?.trim();
    return Boolean(bucket && key && secret);
  }

  private async client() {
    if (!this.s3Client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.s3Client = new S3Client({
        region: this.region(),
        credentials: {
          accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID')!.trim(),
          secretAccessKey: this.config
            .get<string>('AWS_SECRET_ACCESS_KEY')!
            .trim(),
        },
      });
    }
    return this.s3Client;
  }

  private publicUrl(path: string): string {
    const bucket = this.bucket();
    const region = this.region();
    const encoded = path
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    if (region === 'us-east-1') {
      return `https://${bucket}.s3.amazonaws.com/${encoded}`;
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
  }

  private publicReadEnabled(): boolean {
    if (this.objectAclUnsupported) return false;
    return storageObjectAclEnabled(this.config, 'AWS_S3_PUBLIC_READ');
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const putBase = {
      Bucket: this.bucket(),
      Key: input.path,
      Body: input.buffer,
      ContentType: input.contentType,
      Metadata: { owner: input.owner },
    };

    if (this.publicReadEnabled()) {
      try {
        await client.send(
          new PutObjectCommand({ ...putBase, ACL: 'public-read' }),
        );
      } catch (err) {
        if (isObjectAclUnsupportedError(err)) {
          this.objectAclUnsupported = true;
          this.logger.debug(
            `S3 ACL public-read indisponible (bucket policy) — uploads sans ACL objet`,
          );
          await client.send(new PutObjectCommand(putBase));
        } else {
          this.logger.warn(
            `S3 ACL public-read skipped for ${input.path}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          await client.send(new PutObjectCommand(putBase));
        }
      }
    } else {
      await client.send(new PutObjectCommand(putBase));
    }

    const customBase = this.config.get<string>('AWS_S3_PUBLIC_BASE_URL')?.trim();
    const url = customBase
      ? `${customBase.replace(/\/+$/, '')}/${input.path
          .split('/')
          .map((s) => encodeURIComponent(s))
          .join('/')}`
      : this.publicUrl(input.path);
    return {
      url,
      path: input.path,
      engine: this.id,
    };
  }

  async readObject(objectPath: string): Promise<StorageObjectStream> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const out = await client.send(
      new GetObjectCommand({
        Bucket: this.bucket(),
        Key: objectPath,
      }),
    );
    if (!out.Body) {
      throw new Error('s3_object_empty');
    }
    return {
      body: out.Body as NodeJS.ReadableStream,
      contentType:
        typeof out.ContentType === 'string' ? out.ContentType : undefined,
    };
  }

  async delete(pathOrUrl: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket(),
        Key: extractObjectPath(pathOrUrl),
      }),
    );
  }

  async deleteFilesWithPrefix(prefix: string): Promise<void> {
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const client = await this.client();
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket(),
          Prefix: normalized,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      if (!keys.length) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefix', err);
    }
  }

  async deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void> {
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const keepPath = extractObjectPath(keepPathOrUrl);
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const client = await this.client();
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket(),
          Prefix: normalized,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k) && k !== keepPath);
      if (!keys.length) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefixExcept', err);
    }
  }
}

@Injectable()
export class MinioStorageEngine implements IStorageEngine {
  readonly id: StorageEngineId = 'minio';
  private readonly logger = new Logger(MinioStorageEngine.name);
  private readonly s3Clients = new Map<
    string,
    import('@aws-sdk/client-s3').S3Client
  >();
  private objectAclUnsupported = false;

  constructor(private readonly config: ConfigService) {}

  private bucket(): string {
    return this.config.get<string>('MINIO_BUCKET')?.trim() || '';
  }

  private endpoints(): string[] {
    return parseMinioEndpoints(this.config);
  }

  private primaryEndpoint(): string {
    return this.endpoints()[0] ?? '';
  }

  private forcePathStyle(): boolean {
    const raw = this.config.get<string>('MINIO_FORCE_PATH_STYLE')?.trim();
    if (raw === 'false') return false;
    return true;
  }

  isConfigured(): boolean {
    const bucket = this.bucket();
    const key = this.config.get<string>('MINIO_ACCESS_KEY')?.trim();
    const secret = this.config.get<string>('MINIO_SECRET_KEY')?.trim();
    return Boolean(bucket && key && secret && this.primaryEndpoint());
  }

  /** Écritures et suppressions : site primaire uniquement (réplication MinIO côté serveur). */
  private async primaryClient() {
    return this.clientFor(this.primaryEndpoint());
  }

  private async clientFor(endpoint: string) {
    const normalized = normalizeMinioEndpoint(endpoint);
    let client = this.s3Clients.get(normalized);
    if (!client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      client = new S3Client(buildMinioS3ClientConfig(this.config, normalized));
      this.s3Clients.set(normalized, client);
    }
    return client;
  }

  private publicUrl(path: string): string {
    const customBase = this.config.get<string>('MINIO_PUBLIC_BASE_URL')?.trim();
    const encoded = path
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    if (customBase) {
      return `${customBase.replace(/\/+$/, '')}/${encoded}`;
    }
    const bucket = this.bucket();
    const endpoint = this.primaryEndpoint().replace(/\/+$/, '');
    if (this.forcePathStyle()) {
      return `${endpoint}/${bucket}/${encoded}`;
    }
    try {
      const u = new URL(endpoint);
      return `${u.protocol}//${bucket}.${u.host}/${encoded}`;
    } catch {
      return `${endpoint}/${bucket}/${encoded}`;
    }
  }

  private publicReadEnabled(): boolean {
    if (this.objectAclUnsupported) return false;
    return storageObjectAclEnabled(this.config, 'MINIO_PUBLIC_READ');
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.primaryClient();
    const putBase = {
      Bucket: this.bucket(),
      Key: input.path,
      Body: input.buffer,
      ContentType: input.contentType,
      Metadata: { owner: input.owner },
    };

    if (this.publicReadEnabled()) {
      try {
        await client.send(
          new PutObjectCommand({ ...putBase, ACL: 'public-read' }),
        );
      } catch (err) {
        if (isObjectAclUnsupportedError(err)) {
          this.objectAclUnsupported = true;
          this.logger.debug(
            `MinIO ACL public-read indisponible — uploads sans ACL objet`,
          );
          await client.send(new PutObjectCommand(putBase));
        } else {
          this.logger.warn(
            `MinIO ACL public-read skipped for ${input.path}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          await client.send(new PutObjectCommand(putBase));
        }
      }
    } else {
      await client.send(new PutObjectCommand(putBase));
    }

    return {
      url: this.publicUrl(input.path),
      path: input.path,
      engine: this.id,
    };
  }

  async readObject(objectPath: string): Promise<StorageObjectStream> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const endpoints = this.endpoints();
    let lastError: unknown;
    for (const endpoint of endpoints) {
      try {
        const client = await this.clientFor(endpoint);
        const out = await client.send(
          new GetObjectCommand({
            Bucket: this.bucket(),
            Key: objectPath,
          }),
        );
        if (!out.Body) {
          throw new Error('minio_object_empty');
        }
        if (endpoint !== this.primaryEndpoint()) {
          this.logger.warn(
            `MinIO lecture via réplica ${endpoint} (primaire indisponible ou objet absent)`,
          );
        }
        return {
          body: out.Body as NodeJS.ReadableStream,
          contentType:
            typeof out.ContentType === 'string' ? out.ContentType : undefined,
        };
      } catch (err) {
        lastError = err;
        this.logger.debug(
          `MinIO GetObject échoué sur ${endpoint}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('minio_read_failed');
  }

  async delete(pathOrUrl: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.primaryClient();
    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket(),
        Key: extractObjectPath(pathOrUrl),
      }),
    );
  }

  async deleteFilesWithPrefix(prefix: string): Promise<void> {
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const client = await this.primaryClient();
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket(),
          Prefix: normalized,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      if (!keys.length) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefix', err);
    }
  }

  async deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void> {
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const keepPath = extractObjectPath(keepPathOrUrl);
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefixExcept', err);
    }
  }
}

@Injectable()
export class R2StorageEngine implements IStorageEngine {
  readonly id: StorageEngineId = 'r2';
  private readonly logger = new Logger(R2StorageEngine.name);
  private s3Client: import('@aws-sdk/client-s3').S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  private bucket(): string {
    return this.config.get<string>('R2_BUCKET')?.trim() || '';
  }

  private endpoint(): string {
    const custom = this.config.get<string>('R2_ENDPOINT')?.trim();
    if (custom) return custom.replace(/\/+$/, '');
    const accountId = this.config.get<string>('R2_ACCOUNT_ID')?.trim();
    if (accountId) {
      return `https://${accountId}.r2.cloudflarestorage.com`;
    }
    return '';
  }

  isConfigured(): boolean {
    const bucket = this.bucket();
    const key = this.config.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secret = this.config.get<string>('R2_SECRET_ACCESS_KEY')?.trim();
    return Boolean(bucket && key && secret && this.endpoint());
  }

  private async client() {
    if (!this.s3Client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: this.endpoint(),
        credentials: {
          accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID')!.trim(),
          secretAccessKey: this.config
            .get<string>('R2_SECRET_ACCESS_KEY')!
            .trim(),
        },
        forcePathStyle: true,
      });
    }
    return this.s3Client;
  }

  private publicUrl(path: string): string {
    const encoded = path
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    const customBase = this.config.get<string>('R2_PUBLIC_BASE_URL')?.trim();
    if (customBase) {
      return `${customBase.replace(/\/+$/, '')}/${encoded}`;
    }
    const bucket = this.bucket();
    return `${this.endpoint()}/${bucket}/${encoded}`;
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: input.path,
        Body: input.buffer,
        ContentType: input.contentType,
        Metadata: { owner: input.owner },
      }),
    );
    return {
      url: this.publicUrl(input.path),
      path: input.path,
      engine: this.id,
    };
  }

  async readObject(objectPath: string): Promise<StorageObjectStream> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const out = await client.send(
      new GetObjectCommand({
        Bucket: this.bucket(),
        Key: objectPath,
      }),
    );
    if (!out.Body) {
      throw new Error('r2_object_empty');
    }
    return {
      body: out.Body as NodeJS.ReadableStream,
      contentType:
        typeof out.ContentType === 'string' ? out.ContentType : undefined,
    };
  }

  async delete(pathOrUrl: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket(),
        Key: extractObjectPath(pathOrUrl),
      }),
    );
  }

  async deleteFilesWithPrefix(prefix: string): Promise<void> {
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const client = await this.client();
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket(),
          Prefix: normalized,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      if (!keys.length) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefix', err);
    }
  }

  async deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void> {
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const keepPath = extractObjectPath(keepPathOrUrl);
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const client = await this.client();
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket(),
          Prefix: normalized,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k) && k !== keepPath);
      if (!keys.length) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (err) {
      this.logger.error('deleteFilesWithPrefixExcept', err);
    }
  }
}
