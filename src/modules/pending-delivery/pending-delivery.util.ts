import { haversineDistance } from '@utils/helpers';

const PROOF_PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

export type ProofPhotoJsonInput = {
  fileBase64: string;
  filename: string;
  mimeType?: string;
};

export function isAllowedProofPhotoMime(mime: string): boolean {
  return /^image\/(jpeg|png|webp|heic|heif)$/i.test(mime.trim());
}

export function inferProofPhotoMimeFromFilename(filename: string): string | null {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  if (/\.jpe?g$/i.test(lower)) return 'image/jpeg';
  return null;
}

export function multerFileFromProofPhotoJson(
  input: ProofPhotoJsonInput,
  maxBytes: number,
): Express.Multer.File {
  const raw = String(input.fileBase64 ?? '')
    .replace(/\s/g, '')
    .replace(/^data:image\/[^;]+;base64,/i, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('invalid_base64');
  }
  if (!buffer.length) {
    throw new Error('empty_image');
  }
  if (buffer.length > maxBytes) {
    throw new Error('file_too_large');
  }
  const name = (input.filename || 'proof.jpg').trim() || 'proof.jpg';
  if (!PROOF_PHOTO_EXT.test(name)) {
    throw new Error('invalid_file_type');
  }
  let mimetype = (input.mimeType || '').trim();
  if (!mimetype) {
    const inferred = inferProofPhotoMimeFromFilename(name);
    if (!inferred) {
      throw new Error('invalid_file_type');
    }
    mimetype = inferred;
  }
  if (!isAllowedProofPhotoMime(mimetype)) {
    throw new Error('invalid_file_type');
  }
  return {
    fieldname: 'proofPhotos',
    originalname: name,
    encoding: '7bit',
    mimetype,
    buffer,
    size: buffer.length,
    destination: '',
    filename: '',
    path: '',
    stream: undefined,
  } as Express.Multer.File;
}

export function proofPhotosJsonToMulterFiles(
  photos: ProofPhotoJsonInput[] | undefined,
  maxBytes: number,
): Express.Multer.File[] {
  if (!photos?.length) {
    return [];
  }
  return photos.map((photo) => multerFileFromProofPhotoJson(photo, maxBytes));
}

/** Distance en mètres entre deux points WGS84. */
export function distanceMetersBetweenPoints(args: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}): number {
  const km = haversineDistance(
    [args.fromLng, args.fromLat],
    [args.toLng, args.toLat],
  );
  return Math.round(km * 1000);
}

export function isMeaningfulGeoCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

export function formatDistanceMetersLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Commande encore en cours — le même livreur peut renvoyer / remplacer la preuve. */
export function canCourierReplacePendingDeliveryProof(args: {
  orderStatus: string;
  sameDeliveryAgent: boolean;
}): boolean {
  if (!args.sameDeliveryAgent) return false;
  return String(args.orderStatus).trim().toLowerCase() === 'shipped';
}

/** Bloque une nouvelle soumission (preuve active + pas de resoumission autorisée). */
export function shouldBlockPendingDeliveryResubmit(args: {
  orderStatus: string;
  existingProofStatus: string;
  sameDeliveryAgent: boolean;
}): boolean {
  if (String(args.existingProofStatus).trim() === 'admin_rejected') {
    return false;
  }
  if (String(args.orderStatus).trim().toLowerCase() === 'completed') {
    return false;
  }
  if (
    canCourierReplacePendingDeliveryProof({
      orderStatus: args.orderStatus,
      sameDeliveryAgent: args.sameDeliveryAgent,
    })
  ) {
    return false;
  }
  return true;
}
