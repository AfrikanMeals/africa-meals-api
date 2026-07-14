/**
 * Helpers photo de profil JSON+base64 (évite multipart 415 Fastify).
 */

export function decodeProfileImageBase64(imageBase64: string): Buffer {
  const raw = String(imageBase64 ?? '')
    .replace(/\s/g, '')
    .replace(/^data:image\/[^;]+;base64,/i, '');
  return Buffer.from(raw, 'base64');
}

export function isAllowedProfileImageFilename(name: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(String(name ?? '').trim());
}

export function profileImageMimeFromFilename(name: string): string {
  const lower = String(name ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
