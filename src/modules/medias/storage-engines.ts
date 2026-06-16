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

    if (this.config.get<string>('GCS_PUBLIC_READ')?.trim() !== 'false') {
      try {
        await file.makePublic();
      } catch (err) {
        this.logger.warn(
          `GCS makePublic skipped for gs://${bucket}/${input.path}: ${
            err instanceof Error ? err.message : String(err)
          } (bucket IAM allUsers:objectViewer required if UBLA)`,
        );
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
    return this.config.get<string>('AWS_S3_PUBLIC_READ')?.trim() !== 'false';
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
        this.logger.warn(
          `S3 ACL public-read skipped for ${input.path}: ${
            err instanceof Error ? err.message : String(err)
          } (configure bucket policy s3:GetObject for Principal "*", or enable ACLs on bucket)`,
        );
        await client.send(new PutObjectCommand(putBase));
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
