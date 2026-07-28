import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
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
  detectEngineFromUrl,
  extractObjectPath,
  isStorageObjectNotFoundError,
  looksLikeMinioUrl,
  looksLikeR2Url,
  looksLikeVercelBlobUrl,
  StorageEngineId,
  StorageObjectStream,
  StorageUploadResult,
} from './storage-engine.types';
import { isDirectPublicReadAvailable } from './storage-public-access.util';
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

  private isLegacyFirebaseStorageUrl(url: string): boolean {
    return url.includes('firebasestorage.googleapis.com');
  }

  /** URL GCS directe (path-style ou virtual-hosted) — bucket privé → proxy. */
  private isGcsDirectUrl(url: string): boolean {
    return (
      url.includes('storage.googleapis.com') ||
      /\.storage\.googleapis\.com(\/|$)/i.test(url)
    );
  }

  private isDirectObjectStoreUrl(url: string): boolean {
    return (
      this.isGcsDirectUrl(url) ||
      this.isLegacyFirebaseStorageUrl(url) ||
      url.includes('.s3.') ||
      url.includes('s3.amazonaws.com') ||
      this.isDirectR2Url(url) ||
      this.isDirectVercelBlobUrl(url) ||
      this.isDirectMinioUrl(url)
    );
  }

  /** Moteur effectif pour les URLs publiques directes (hors proxy). */
  private async resolveDirectStorageEngine(): Promise<StorageEngineId> {
    const settings = await this.storageSettings.getPublicSettings();
    let engine: StorageEngineMode = settings.storageEngine;
    if (engine === 'auto') {
      if (this.config.get<string>('AWS_S3_BUCKET')?.trim()) {
        engine = 's3';
      } else if (this.config.get<string>('R2_BUCKET')?.trim()) {
        engine = 'r2';
      } else if (
        this.config.get<string>('BLOB_READ_WRITE_TOKEN')?.trim() ||
        this.config.get<string>('VERCEL_BLOB_READ_WRITE_TOKEN')?.trim()
      ) {
        engine = 'vercelBlob';
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
    return engine;
  }

  private isDirectR2Url(url: string): boolean {
    const publicBase = this.config.get<string>('R2_PUBLIC_BASE_URL')?.trim();
    if (publicBase && url.startsWith(publicBase.replace(/\/+$/, ''))) {
      return true;
    }
    return looksLikeR2Url(url);
  }

  private isDirectVercelBlobUrl(url: string): boolean {
    return looksLikeVercelBlobUrl(url);
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
    // Vercel Blob privé : pas d’URL anonyme — le caller ne dé-proxifie que si
    // canServeDirectUrl (toujours false pour vercelBlob).
    if (engine === 'vercelBlob') {
      return this.buildProxyPublicUrl(objectPath);
    }
    const bucket =
      this.config.get<string>('GCS_BUCKET')?.trim() ||
      this.config.get<string>('GOOGLE_CLOUD_STORAGE_BUCKET')?.trim() ||
      '';
    return `https://storage.googleapis.com/${bucket}/${encoded}`;
  }

  /**
   * Le moteur peut-il encore servir une URL bucket **directe** à un client anonyme ?
   * `false` = bucket privé sans CDN (GCS PAP, S3 « Block all public access »).
   */
  private canServeDirectUrl(engine: StorageEngineId): boolean {
    return isDirectPublicReadAvailable(engine, (key) =>
      this.config.get<string>(key),
    );
  }

  /**
   * Proxy médias effectif : toggle admin **ou** bucket non lisible publiquement.
   *
   * Le repli automatique évite le piège principal de la bascule S3 en bucket privé :
   * sans lui, cocher « Block all public access » côté AWS sans activer le toggle
   * admin renverrait des URLs `bucket.s3.…` en 403 sur mobile, admin et web.
   *
   * Le moteur est déduit de l'URL source quand elle est connue : dans un pool mixte,
   * un S3 privé ne doit pas forcer le proxy sur des médias MinIO restés publics.
   */
  private async isMediaProxyEnabled(
    engine?: StorageEngineId | null,
  ): Promise<boolean> {
    const settings = await this.storageSettings.getPublicSettings();
    if (settings.mediaProxyEnabled === true) return true;
    const target = engine ?? (await this.resolveDirectStorageEngine());
    return !this.canServeDirectUrl(target);
  }

  /**
   * URL déjà servie par une base publique CDN (MINIO/S3/R2_PUBLIC_BASE_URL) —
   * lisible sans passer par `/medias/public/`.
   */
  private isConfiguredPublicBaseUrl(url: string): boolean {
    for (const base of this.configuredPublicBasesFromEnv()) {
      if (url.startsWith(base)) return true;
    }
    // Domaine CDN objet Wise Eat (même sans env aligné sur le pod).
    try {
      return /^files\.wise-eat\.com$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  /** Bases CDN déclarées en env (sans le fallback `files.` hardcodé). */
  private configuredPublicBasesFromEnv(): string[] {
    const out: string[] = [];
    for (const key of [
      'MINIO_PUBLIC_BASE_URL',
      'AWS_S3_PUBLIC_BASE_URL',
      'R2_PUBLIC_BASE_URL',
    ] as const) {
      const base = this.config.get<string>(key)?.trim();
      if (!base) continue;
      out.push(base.replace(/\/+$/, ''));
    }
    return out;
  }

  /**
   * Bases HTTP autorisées pour servir un objet sans credentials SDK
   * (fallback lecture proxy + restauration d’URL).
   */
  private publicObjectReadBases(): string[] {
    const bases = this.configuredPublicBasesFromEnv();
    // CDN historique objets catalogue — présent même si l’env MinIO pointe ailleurs.
    if (!bases.some((b) => /files\.wise-eat\.com/i.test(b))) {
      bases.push('https://files.wise-eat.com');
    }
    return bases;
  }

  /** Hosts autorisés pour le fallback HTTP (anti-SSRF). */
  private isAllowedPublicReadHost(host: string): boolean {
    const h = host.toLowerCase();
    if (h === 'files.wise-eat.com' || h === 'storage.wise-eat.com') return true;
    if (/^storage-[a-z0-9-]+\.wise-eat\.com$/i.test(h)) return true;
    for (const base of this.configuredPublicBasesFromEnv()) {
      try {
        if (new URL(base).hostname.toLowerCase() === h) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  /**
   * Si l’URL proxy embarque encore `files.wise-eat.com`, restaurer le CDN
   * (le proxy SDK renvoie 500 quand l’objet n’est que sur ce CDN).
   */
  private restoreFilesCdnUrlIfEmbedded(raw: string, objectPath: string): string | undefined {
    if (!/files\.wise-eat\.com/i.test(raw)) return undefined;
    const clean = objectPath.replace(/^\/+/, '');
    if (!clean || clean.includes('..') || /^https?:\/\//i.test(clean)) {
      return undefined;
    }
    return `https://files.wise-eat.com/${this.encodeObjectPath(clean)}`;
  }

  /**
   * GET public sur les bases CDN configurées — dernier recours du proxy
   * quand MinIO/S3/GCS n’ont pas l’objet (ou SDK en erreur).
   */
  private async tryStreamFromPublicBases(
    objectPath: string,
  ): Promise<StorageObjectStream | null> {
    const encoded = this.encodeObjectPath(objectPath);
    for (const base of this.publicObjectReadBases()) {
      let url: string;
      try {
        const u = new URL(base);
        if (!this.isAllowedPublicReadHost(u.hostname)) continue;
        url = `${base.replace(/\/+$/, '')}/${encoded}`;
      } catch {
        continue;
      }
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
        });
        if (!res.ok || !res.body) continue;
        // Même conversion que Vercel Blob : éviter Readable.fromWeb sous Nest/Fastify.
        const { webReadableToNodePassThrough } = await import(
          './web-stream-to-node.util'
        );
        return {
          body: webReadableToNodePassThrough(
            res.body as ReadableStream<Uint8Array>,
          ),
          contentType: res.headers.get('content-type') ?? undefined,
        };
      } catch (err) {
        this.logger.debug(
          `CDN fallback Get ${url}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return null;
  }

  /** Normalise les URLs médias selon le réglage admin (proxy ou direct GCS/S3). */
  async resolvePublicMediaUrl(
    url: string | null | undefined,
  ): Promise<string | undefined> {
    if (!url?.trim()) return undefined;
    const raw = url.trim();
    const useProxy = await this.isMediaProxyEnabled(detectEngineFromUrl(raw));

    if (useProxy) {
      if (this.isProxyUrl(raw)) {
        const objectPath = extractObjectPath(raw);
        // Fix: URL CDN entière encodée sous /medias/public/ → re-normaliser.
        if (/^https?:\/\//i.test(objectPath) || objectPath.includes('://')) {
          return this.resolvePublicMediaUrl(objectPath);
        }
        const clean = objectPath.replace(/^\/+/, '');
        if (!clean || clean.includes('..')) return raw;
        // Fix: double-proxy files.wise-eat.com → CDN direct (proxy SDK = 500).
        const filesCdn = this.restoreFilesCdnUrlIfEmbedded(raw, clean);
        if (filesCdn) return filesCdn;
        return this.buildProxyPublicUrl(clean);
      }
      // Base CDN publique : ne pas re-proxifier (sinon double-proxy cassé).
      if (this.isConfiguredPublicBaseUrl(raw)) {
        return raw;
      }
      if (this.isDirectObjectStoreUrl(raw)) {
        const objectPath = extractObjectPath(raw);
        // Garde-fou : ne jamais préfixer une URL http restante.
        if (/^https?:\/\//i.test(objectPath)) {
          return raw;
        }
        return this.buildProxyPublicUrl(objectPath);
      }
      return raw;
    }

    if (this.isProxyUrl(raw)) {
      const objectPath = extractObjectPath(raw);
      const engine = await this.resolveDirectStorageEngine();
      // Ne dé-proxifier que vers un moteur encore lisible publiquement : sinon on
      // transformerait une URL qui fonctionne en 403.
      if (
        (engine === 'gcs' ||
          engine === 's3' ||
          engine === 'minio' ||
          engine === 'r2' ||
          engine === 'vercelBlob') &&
        this.canServeDirectUrl(engine)
      ) {
        return this.directUrlForObjectPath(objectPath, engine);
      }
      return raw;
    }

    if (this.isLegacyFirebaseStorageUrl(raw)) {
      const engine = await this.resolveDirectStorageEngine();
      if (engine !== 'firebase') {
        const objectPath = extractObjectPath(raw);
        return this.canServeDirectUrl(engine)
          ? this.directUrlForObjectPath(objectPath, engine)
          : this.buildProxyPublicUrl(objectPath);
      }
    }

    return raw;
  }

  private async resolveUploadPublicUrl(
    result: StorageUploadResult,
  ): Promise<string> {
    // Firebase (URL à token) / R2+CDN / MinIO public : garder l’URL moteur.
    if (this.canServeDirectUrl(result.engine)) {
      return result.url;
    }
    // GCS PAP · S3 privé · R2 sans domaine public · MinIO private → proxy API.
    const useProxy = await this.isMediaProxyEnabled(result.engine);
    if (
      useProxy &&
      (result.engine === 'gcs' ||
        result.engine === 's3' ||
        result.engine === 'minio' ||
        result.engine === 'r2' ||
        result.engine === 'vercelBlob')
    ) {
      return this.buildProxyPublicUrl(result.path);
    }
    return result.url;
  }

  async streamPublicObject(objectPath: string): Promise<StorageObjectStream> {
    // Fix: clients peuvent encore frapper un double-proxy
    // (`/medias/public/https%3A//files.wise-eat.com/…`) — réduire à la clé objet.
    let normalized = objectPath.replace(/^\/+/, '').trim();
    if (
      /^https?:\/\//i.test(normalized) ||
      /%3A/i.test(normalized) ||
      normalized.includes('://')
    ) {
      normalized = extractObjectPath(
        /^https?:\/\//i.test(normalized) || normalized.includes('://')
          ? normalized
          : decodeURIComponent(normalized),
      ).replace(/^\/+/, '');
    }
    if (!normalized || normalized.includes('..') || /^https?:\/\//i.test(normalized)) {
      throw new BadRequestException('invalid_media_path');
    }
    const settings = await this.storageSettings.getPublicSettings();
    const engines = this.engineFactory.enginesToTryForRead(
      settings.storageEngine,
      settings.enginesEnabled,
      settings.storageEnginePool,
    );

    let lastError: unknown;
    let sawOnlyNotFound = true;
    // Au moins un moteur a confirmé l’absence (NoSuchKey) — utile si d’autres
    // renvoient AccessDenied/ECONNREFUSED (sinon proxy → 500 pour tout chemin).
    let sawAnyNotFound = false;
    for (const engine of engines) {
      try {
        return await engine.readObject(normalized);
      } catch (err) {
        lastError = err;
        // Fix: ne pas court-circuiter le pool sur AccessDenied/ECONNREFUSED du
        // premier moteur — enchaîner + fallback CDN `files.wise-eat.com`.
        if (isStorageObjectNotFoundError(err)) {
          sawAnyNotFound = true;
        } else {
          sawOnlyNotFound = false;
          this.logger.warn(
            `Proxy media ${engine.id} failed for ${normalized}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    const fromCdn = await this.tryStreamFromPublicBases(normalized);
    if (fromCdn) return fromCdn;

    // Fix: AccessDenied MinIO/GCS ne doit pas produire 500 si un moteur
    // (ex. vercelBlob) a déjà répondu « objet absent ».
    if (sawOnlyNotFound || sawAnyNotFound) {
      throw new NotFoundException('media_not_found');
    }
    if (lastError) {
      throw lastError;
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
    return this.engineFactory.resolve(
      engineMode,
      settings.enginesEnabled,
      settings.storageEnginePool,
    );
  }

  private async uploadWithFallback(
    primary: IStorageEngine,
    settings: Pick<
      StorageSettingsResponse,
      'fallbackStorageEngine' | 'enginesEnabled' | 'storageEnginePool'
    >,
    input: StorageUploadInput,
  ): Promise<StorageUploadResult> {
    const chain = this.engineFactory.enginesToTryForUpload(primary, settings);
    let lastError: unknown;
    for (let i = 0; i < chain.length; i++) {
      const engine = chain[i];
      try {
        if (i > 0) {
          this.logger.warn(
            `Upload repli moteur ${engine.id} après échec ${chain[i - 1].id} (${input.path})`,
          );
        }
        return await engine.upload(input);
      } catch (err) {
        lastError = err;
        if (i < chain.length - 1) {
          this.logger.warn(
            `Upload échoué sur ${engine.id} (${input.path}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    throw lastError;
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
      this.logger.error(
        'MediasService.upload',
        e instanceof Error ? e.stack : String(e),
      );
      throw new ServiceUnavailableException('storage_upload_failed');
    }
  }

  /**
   * Photos preuve livraison : compression dédiée (toujours) + un seul chargement
   * des réglages stockage pour tout le lot.
   */
  async uploadDeliveryProofBatch(
    files: Express.Multer.File[],
    user: UserModel,
  ): Promise<string[]> {
    if (!files.length) return [];
    try {
      const settings = await this.storageSettings.getPublicSettings();
      const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
      const engine = await this.resolveUploadEngine('delivery-proof');
      const owner = user._id.toString();

      const prepared = await Promise.all(
        files.map(async (file) => {
          let current = prepareIncomingUploadFile(file);
          assertUploadFileSignature(current);
          if ((current.buffer?.length ?? current.size ?? 0) > maxBytes) {
            throw new BadRequestException('file_too_large');
          }
          current = await this.compression.compressDeliveryProof(current);
          if ((current.buffer?.length ?? current.size ?? 0) > maxBytes) {
            throw new BadRequestException('file_too_large');
          }
          return current;
        }),
      );

      return Promise.all(
        prepared.map(async (file) => {
          const path = `delivery-proof/${uuid()}${extname(file.originalname)}`;
          const result = await this.uploadWithFallback(engine, settings, {
            buffer: file.buffer,
            path,
            contentType: file.mimetype,
            owner,
          });
          const url = await this.resolveUploadPublicUrl(result);
          return String(url ?? '').trim();
        }),
      );
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(
        'MediasService.uploadDeliveryProofBatch',
        e instanceof Error ? e.stack : String(e),
      );
      throw new ServiceUnavailableException('storage_upload_failed');
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
          settings.enginesEnabled,
          settings.storageEnginePool,
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
      settings.storageEnginePool,
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
      settings.storageEnginePool,
    );
    await engine.deleteFilesWithPrefixExcept(prefix, keepPathOrUrl);
  }
}
