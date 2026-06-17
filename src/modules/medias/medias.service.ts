import {
  BadRequestException,
  Injectable,
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
  StorageEngineId,
  StorageObjectStream,
  StorageUploadResult,
} from './storage-engine.types';
import { StorageEngineMode } from '@schemas/storage-settings.schema';

/**
 * Service de stockage multi-moteur (Firebase, GCS, S3) avec compression et limites admin.
 */
@Injectable()
export class MediasService {
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

  private isDirectGcsOrS3Url(url: string): boolean {
    return (
      url.includes('storage.googleapis.com') ||
      url.includes('.s3.') ||
      url.includes('s3.amazonaws.com')
    );
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
      if (this.isDirectGcsOrS3Url(raw)) {
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
        } else if (
          this.config.get<string>('GCS_BUCKET')?.trim() ||
          this.config.get<string>('GOOGLE_CLOUD_STORAGE_BUCKET')?.trim()
        ) {
          engine = 'gcs';
        } else {
          engine = 'firebase';
        }
      }
      if (engine === 'gcs' || engine === 's3') {
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
      (result.engine === 'gcs' || result.engine === 's3')
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
      const engine = this.engineFactory.resolve(settings.storageEngine);
      const path =
        basePath.length > 0
          ? `${basePath}/${uuid()}${extname(prepared.originalname)}`
          : `${uuid()}${extname(prepared.originalname)}`;
      const result = await engine.upload({
        buffer: prepared.buffer,
        path,
        contentType: prepared.mimetype,
        owner: user._id.toString(),
      });
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
    const engine = this.engineFactory.resolve(settings.storageEngine);
    const ext =
      args.extension ??
      (args.contentType.includes('png')
        ? '.png'
        : args.contentType.includes('webp')
          ? '.webp'
          : '.jpg');
    const base = args.basePath.replace(/^\/+|\/+$/g, '');
    const path = `${base}/${uuid()}${ext}`;
    const result = await engine.upload({
      buffer: args.buffer,
      path,
      contentType: args.contentType,
      owner: 'system',
    });
    return await this.resolveUploadPublicUrl(result);
  }

  async delete(pathOrUrl: string) {
    try {
      if (pathOrUrl.includes('/medias/public/')) {
        const objectPath = extractObjectPath(pathOrUrl);
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
      const engine = this.engineFactory.resolveForDelete(pathOrUrl);
      await engine.delete(pathOrUrl);
    } catch (e) {
      console.error('MediasService.delete', e);
      throw e;
    }
  }

  async deleteFilesWithPrefix(prefix: string): Promise<void> {
    const settings = await this.storageSettings.getPublicSettings();
    const engine = this.engineFactory.resolve(settings.storageEngine);
    await engine.deleteFilesWithPrefix(prefix);
  }

  async deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void> {
    const settings = await this.storageSettings.getPublicSettings();
    const engine = this.engineFactory.resolve(settings.storageEngine);
    await engine.deleteFilesWithPrefixExcept(prefix, keepPathOrUrl);
  }
}
