import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserModel } from '@schemas/user.schema';
import { StorageSettingsService } from '@modules/storage-settings/storage-settings.service';
import { assertUploadFileSignature } from '@common/uploads/upload-file-signature.util';
import { prepareIncomingUploadFile } from 'src/incoming-upload-file';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import { ImageCompressionService } from './image-compression.service';
import { StorageEngineFactory } from './storage-engine.factory';
import {
  extractObjectPath,
  isStorageObjectNotFoundError,
  looksLikeMinioUrl,
  looksLikeR2Url,
  StorageEngineId,
  StorageObjectStream,
  StorageUploadResult,
} from './storage-engine.types';
import { StorageEngineMode } from '@schemas/storage-settings.schema';
import type { StorageSettingsResponse } from '@modules/storage-settings/storage-settings.service';
import { inferStorageModuleFromBasePath } from '@schemas/storage-module.constants';
import type { IStorageEngine, StorageUploadInput } from './storage-engine.types';

/**
 * Service de stockage multi-moteur (Firebase, GCS, S3, MinIO, R2) avec compression et limites admin.
 */
@Injectable()
export class MediasService {
  private readonly logger = new Logger(MediasService.name);

  constructor(
    private readonly storageSettings: StorageSettingsService,
    private readonly compression: ImageCompressionService,
    private readonly engineFactory: StorageEngineFactory,
    private readonly config: ConfigService,
  ) {}

  private apiPublicBaseUrl(): string {
    const raw = this.config.get<string>('API_PUBLIC_BASE_URL')?.trim() || '';
    if (!raw) return '';
    try {
      const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      let pathname = u.pathname.replace(/\/+$/, '');
      const isLocal =
        u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      const nestPrefix =
        this.config.get<string>('NEST_GLOBAL_PREFIX')?.trim() ?? 'api';
      if (isLocal && nestPrefix === 'api' && !pathname.endsWith('/api')) {
        pathname = pathname ? `${pathname}/api` : '/api';
      }
      return `${u.origin}${pathname}`.replace(/\/+$/, '');
    } catch {
      return raw.replace(/\/+$/, '');
    }
  }

  buildProxyPublicUrl(objectPath: string): string {
    const base = this.apiPublicBaseUrl();
    const normalized = objectPath.replace(/^\/+/, '');
    if (!base) {
      return normalized;
    }
    return `${base.replace(/\/+$/, '')}/medias/public/${this.encodeObjectPath(normalized)}`;
  }

  private encodeObjectPath(path: string): string {
    return path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  private isDirectObjectStoreUrl(url: string): boolean {
    return (
      url.includes('storage.googleapis.com') ||
      url.includes('.s3.') ||
      url.includes('s3.amazonaws.com') ||
      this.isDirectR2Url(url) ||
      this.isDirectMinioUrl(url)
    );
  }

  private isDirectR2Url(url: string): boolean {
    const publicBase = this.config.get<string>('R2_PUBLIC_BASE_URL')?.trim();
    if (publicBase && url.startsWith(publicBase.replace(/\/+$/, ''))) {
      return true;
    }
    return looksLikeR2Url(url);
  }

  private isDirectMinioUrl(url: string): boolean {
    const publicBase = this.config.get<string>('MINIO_PUBLIC_BASE_URL')?.trim();
    if (publicBase && url.startsWith(publicBase.replace(/\/+$/, ''))) {
      return true;
    }
    const endpoint = this.config.get<string>('MINIO_ENDPOINT')?.trim();
    if (endpoint) {
      try {
        const ep = new URL(
          endpoint.startsWith('http') ? endpoint : `http://${endpoint}`,
        );
        const u = new URL(url);
        return u.origin === ep.origin;
      } catch {
        return false;
      }
    }
    return looksLikeMinioUrl(url);
  }

  private minioPublicUrl(objectPath: string): string {
    const encoded = this.encodeObjectPath(objectPath);
    const customBase = this.config.get<string>('MINIO_PUBLIC_BASE_URL')?.trim();
    if (customBase) {
      return `${customBase.replace(/\/+$/, '')}/${encoded}`;
    }
    const bucket = this.config.get<string>('MINIO_BUCKET')?.trim() || '';
    const endpointRaw = this.config.get<string>('MINIO_ENDPOINT')?.trim() || '';
    const endpoint = endpointRaw.startsWith('http')
      ? endpointRaw
      : `http://${endpointRaw}`;
    const forcePathStyle =
      this.config.get<string>('MINIO_FORCE_PATH_STYLE')?.trim() !== 'false';
    if (forcePathStyle) {
      return `${endpoint.replace(/\/+$/, '')}/${bucket}/${encoded}`;
    }
    try {
      const u = new URL(endpoint);
      return `${u.protocol}//${bucket}.${u.host}/${encoded}`;
    } catch {
      return `${endpoint.replace(/\/+$/, '')}/${bucket}/${encoded}`;
    }
  }

  private r2PublicUrl(objectPath: string): string {
    const encoded = this.encodeObjectPath(objectPath);
    const customBase = this.config.get<string>('R2_PUBLIC_BASE_URL')?.trim();
    if (customBase) {
      return `${customBase.replace(/\/+$/, '')}/${encoded}`;
    }
    const bucket = this.config.get<string>('R2_BUCKET')?.trim() || '';
    const endpoint =
      this.config.get<string>('R2_ENDPOINT')?.trim()?.replace(/\/+$/, '') ||
      (() => {
        const accountId = this.config.get<string>('R2_ACCOUNT_ID')?.trim();
        return accountId
          ? `https://${accountId}.r2.cloudflarestorage.com`
          : '';
      })();
    return `${endpoint}/${bucket}/${encoded}`;
  }

  private isProxyUrl(url: string): boolean {
    return url.includes('/medias/public/');
  }

  private directUrlForObjectPath(
    objectPath: string,
    engine: StorageEngineId,
  ): string {
    const encoded = this.encodeObjectPath(objectPath);
    if (engine === 's3') {
      const bucket = this.config.get<string>('AWS_S3_BUCKET')?.trim() || '';
      const region = this.config.get<string>('AWS_REGION')?.trim() || 'us-east-1';
      const customBase = this.config.get<string>('AWS_S3_PUBLIC_BASE_URL')?.trim();
      if (customBase) {
        return `${customBase.replace(/\/+$/, '')}/${encoded}`;
      }
      if (region === 'us-east-1') {
        return `https://${bucket}.s3.amazonaws.com/${encoded}`;
      }
      return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
    }
    if (engine === 'minio') {
      return this.minioPublicUrl(objectPath);
    }
    if (engine === 'r2') {
      return this.r2PublicUrl(objectPath);
    }
    const bucket =
      this.config.get<string>('GCS_BUCKET')?.trim() ||
      this.config.get<string>('GOOGLE_CLOUD_STORAGE_BUCKET')?.trim() ||
      '';
    return `https://storage.googleapis.com/${bucket}/${encoded}`;
  }

  private async isMediaProxyEnabled(): Promise<boolean> {
    const settings = await this.storageSettings.getPublicSettings();
    return settings.mediaProxyEnabled === true;
  }

  /** Normalise les URLs médias selon le réglage admin (proxy ou direct GCS/S3). */
  async resolvePublicMediaUrl(
    url: string | null | undefined,
  ): Promise<string | undefined> {
    if (!url?.trim()) return undefined;
    const raw = url.trim();
    const useProxy = await this.isMediaProxyEnabled();

    if (useProxy) {
      if (this.isProxyUrl(raw)) return raw;
      if (this.isDirectObjectStoreUrl(raw)) {
        return this.buildProxyPublicUrl(extractObjectPath(raw));
      }
      return raw;
    }

    if (this.isProxyUrl(raw)) {
      const objectPath = extractObjectPath(raw);
      const settings = await this.storageSettings.getPublicSettings();
      let engine: StorageEngineMode = settings.storageEngine;
      if (engine === 'auto') {
        if (this.config.get<string>('AWS_S3_BUCKET')?.trim()) {
          engine = 's3';
        } else if (this.config.get<string>('R2_BUCKET')?.trim()) {
          engine = 'r2';
        } else if (this.config.get<string>('MINIO_BUCKET')?.trim()) {
          engine = 'minio';
        } else if (
          this.config.get<string>('GCS_BUCKET')?.trim() ||
          this.config.get<string>('GOOGLE_CLOUD_STORAGE_BUCKET')?.trim()
        ) {
          engine = 'gcs';
        } else {
          engine = 'firebase';
        }
      }
      if (engine === 'gcs' || engine === 's3' || engine === 'minio' || engine === 'r2') {
        return this.directUrlForObjectPath(objectPath, engine);
      }
    }

    return raw;
  }

  private async resolveUploadPublicUrl(
    result: StorageUploadResult,
  ): Promise<string> {
    const useProxy = await this.isMediaProxyEnabled();
    if (
      useProxy &&
      (result.engine === 'gcs' ||
        result.engine === 's3' ||
        result.engine === 'minio' ||
        result.engine === 'r2')
    ) {
      return this.buildProxyPublicUrl(result.path);
    }
    return result.url;
  }

  async streamPublicObject(objectPath: string): Promise<StorageObjectStream> {
    const normalized = objectPath.replace(/^\/+/, '').trim();
    if (!normalized || normalized.includes('..')) {
      throw new BadRequestException('invalid_media_path');
    }
    const settings = await this.storageSettings.getPublicSettings();
    const engines = this.engineFactory.enginesToTryForRead(
      settings.storageEngine,
      settings.enginesEnabled,
    );

    for (const engine of engines) {
      try {
        return await engine.readObject(normalized);
      } catch (err) {
        if (isStorageObjectNotFoundError(err)) {
          continue;
        }
        throw err;
      }
    }

    throw new NotFoundException('media_not_found');
  }

  async getMaxFileSizeBytes(): Promise<number> {
    return this.storageSettings.getMaxFileSizeBytes();
  }

  private async resolveUploadEngine(basePath: string) {
    const settings = await this.storageSettings.getPublicSettings();
    const module = inferStorageModuleFromBasePath(basePath);
    const engineMode = this.storageSettings.resolveEngineForModuleFromSettings(
      module,
      settings,
    );
    return this.engineFactory.resolve(engineMode, settings.enginesEnabled);
  }

  private async uploadWithFallback(
    primary: IStorageEngine,
    settings: Pick<
      StorageSettingsResponse,
      'fallbackStorageEngine' | 'enginesEnabled'
    >,
    input: StorageUploadInput,
  ): Promise<StorageUploadResult> {
    try {
      return await primary.upload(input);
    } catch (primaryErr) {
      const fallbackId = settings.fallbackStorageEngine;
      if (
        !fallbackId ||
        fallbackId === primary.id ||
        settings.enginesEnabled[fallbackId] === false
      ) {
        throw primaryErr;
      }
      const fallback = this.engineFactory.byId(fallbackId);
      if (!fallback.isConfigured()) {
        throw primaryErr;
      }
      this.logger.warn(
        `Upload échoué sur ${primary.id}, repli vers ${fallbackId} (${input.path})`,
      );
      try {
        return await fallback.upload(input);
      } catch (fallbackErr) {
        this.logger.error(
          `Repli upload ${fallbackId} échoué (${input.path})`,
          fallbackErr instanceof Error ? fallbackErr.stack : String(fallbackErr),
        );
        throw primaryErr;
      }
    }
  }

  private async prepareForUpload(
    file: Express.Multer.File,
  ): Promise<Express.Multer.File> {
    const settings = await this.storageSettings.getPublicSettings();
    const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
    let prepared = prepareIncomingUploadFile(file);
    assertUploadFileSignature(prepared);
    if ((prepared.buffer?.length ?? prepared.size ?? 0) > maxBytes) {
      throw new BadRequestException('file_too_large');
    }
    if (settings.compressionEnabled) {
      prepared = await this.compression.compressIfImage(prepared);
      if ((prepared.buffer?.length ?? prepared.size ?? 0) > maxBytes) {
        throw new BadRequestException('file_too_large');
      }
    }
    return prepared;
  }

  async upload(file: Express.Multer.File, user: UserModel, basePath = '') {
    try {
      const prepared = await this.prepareForUpload(file);
      const settings = await this.storageSettings.getPublicSettings();
      const engine = await this.resolveUploadEngine(basePath);
      const path =
        basePath.length > 0
          ? `${basePath}/${uuid()}${extname(prepared.originalname)}`
          : `${uuid()}${extname(prepared.originalname)}`;
      const result = await this.uploadWithFallback(
        engine,
        settings,
        {
          buffer: prepared.buffer,
          path,
          contentType: prepared.mimetype,
          owner: user._id.toString(),
        },
      );
      return await this.resolveUploadPublicUrl(result);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      console.error('MediasService.upload', e);
      throw e;
    }
  }

  /** Upload système (e-mails, assets générés) sans utilisateur JWT. */
  async uploadSystemBuffer(args: {
    buffer: Buffer;
    contentType: string;
    basePath: string;
    extension?: string;
  }): Promise<string> {
    const settings = await this.storageSettings.getPublicSettings();
    const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
    if (args.buffer.length > maxBytes) {
      throw new BadRequestException('file_too_large');
    }
    const engine = await this.resolveUploadEngine(args.basePath);
    const ext =
      args.extension ??
      (args.contentType.includes('png')
        ? '.png'
        : args.contentType.includes('webp')
          ? '.webp'
          : '.jpg');
    const base = args.basePath.replace(/^\/+|\/+$/g, '');
    const path = `${base}/${uuid()}${ext}`;
    const result = await this.uploadWithFallback(engine, settings, {
      buffer: args.buffer,
      path,
      contentType: args.contentType,
      owner: 'system',
    });
    return await this.resolveUploadPublicUrl(result);
  }

  async delete(pathOrUrl: string): Promise<void> {
    const target = pathOrUrl?.trim();
    if (!target) return;

    try {
      if (target.includes('/medias/public/')) {
        const objectPath = extractObjectPath(target);
        const settings = await this.storageSettings.getPublicSettings();
        const engines = this.engineFactory.enginesToTryForRead(
          settings.storageEngine,
        );
        for (const engine of engines) {
          try {
            await engine.delete(objectPath);
            return;
          } catch (err) {
            if (isStorageObjectNotFoundError(err)) continue;
            throw err;
          }
        }
        return;
      }
      const engine = this.engineFactory.resolveForDelete(target);
      await engine.delete(target);
    } catch (e) {
      if (isStorageObjectNotFoundError(e)) {
        return;
      }
      console.error('MediasService.delete', e);
      throw e;
    }
  }

  async deleteFilesWithPrefix(prefix: string): Promise<void> {
    const settings = await this.storageSettings.getPublicSettings();
    const engine = this.engineFactory.resolve(
      settings.storageEngine,
      settings.enginesEnabled,
    );
    await engine.deleteFilesWithPrefix(prefix);
  }

  async deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void> {
    const settings = await this.storageSettings.getPublicSettings();
    const engine = this.engineFactory.resolve(
      settings.storageEngine,
      settings.enginesEnabled,
    );
    await engine.deleteFilesWithPrefixExcept(prefix, keepPathOrUrl);
  }
}
