export type StorageEngineId = 'firebase' | 'gcs' | 's3';

export type StorageEngineMode = StorageEngineId | 'auto';

export type StorageUploadResult = {
  url: string;
  path: string;
  engine: StorageEngineId;
};

export type StorageUploadInput = {
  buffer: Buffer;
  path: string;
  contentType: string;
  owner: string;
};

export type StorageObjectStream = {
  body: NodeJS.ReadableStream;
  contentType?: string;
};

export interface IStorageEngine {
  readonly id: StorageEngineId;
  isConfigured(): boolean;
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  readObject(objectPath: string): Promise<StorageObjectStream>;
  delete(pathOrUrl: string): Promise<void>;
  deleteFilesWithPrefix(prefix: string): Promise<void>;
  deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void>;
}

export function extractObjectPath(pathOrUrl: string): string {
  const url = pathOrUrl.trim();
  if (!url.startsWith('http')) return url;
  const proxyMatch = url.match(/\/medias\/public\/([^?]+)/i);
  if (proxyMatch) {
    return decodeURIComponent(proxyMatch[1].replace(/\+/g, ' '));
  }
  const firebaseMatch = url.match(/\/o\/([^?]+)/);
  if (firebaseMatch) {
    return decodeURIComponent(firebaseMatch[1].replace(/\+/g, ' '));
  }
  const gcsMatch = url.match(/storage\.googleapis\.com\/[^/]+\/(.+?)(?:\?|$)/);
  if (gcsMatch) {
    return decodeURIComponent(gcsMatch[1].replace(/\+/g, ' '));
  }
  const s3Match = url.match(
    /(?:s3[.-][^/]+\.amazonaws\.com\/|\.s3\.[^/]+\.amazonaws\.com\/)(.+?)(?:\?|$)/,
  );
  if (s3Match) {
    return decodeURIComponent(s3Match[1].replace(/\+/g, ' '));
  }
  return url;
}

export function detectEngineFromUrl(pathOrUrl: string): StorageEngineId | null {
  const url = pathOrUrl.trim();
  if (!url.startsWith('http')) return null;
  if (url.includes('firebasestorage.googleapis.com')) return 'firebase';
  if (url.includes('/medias/public/')) return null;
  if (url.includes('.s3.') || url.includes('s3.amazonaws.com')) return 's3';
  if (url.includes('storage.googleapis.com')) return 'gcs';
  return null;
}

/** Erreur « objet absent » (Firebase, GCS, S3). */
export function isStorageObjectNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    const msg = String(err ?? '');
    return (
      msg.includes('NoSuchKey') ||
      msg.includes('No such object') ||
      msg.includes('Not Found') ||
      msg.includes('404') ||
      msg.includes('does not exist')
    );
  }
  const o = err as { code?: number | string; message?: string; name?: string };
  if (o.code === 404 || o.code === '404' || o.code === 'NotFound') return true;
  const msg = String(o.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('nosuchkey') ||
    msg.includes('no such object') ||
    msg.includes('not found') ||
    msg.includes('does not exist') ||
    o.name === 'NotFound'
  );
}
