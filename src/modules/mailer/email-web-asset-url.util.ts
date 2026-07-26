import type { ConfigService } from '@nestjs/config';
import { extractObjectPath } from '@modules/medias/storage-engine.types';
import { resolveEmailBrand } from './email-brand.util';

/** Fichiers statiques — africa-meals-web/public/images/… */
const EMAIL_HERO_FILES = new Set([
  'vendor-onboarding-01.png',
  'vendor-onboarding-02.png',
  'delivery-onboarding-01.png',
  'delivery-onboarding-02.png',
  'maintenance-mode-on.png',
  'maintenance-mode-off.png',
]);

const EMAIL_HELP_FILES = new Set([
  'help-section-01.png',
  'help-section-02.png',
]);

const EMAIL_ONBOARDING_FILES = new Set([
  'kyc-vendor-01.png',
  'kyc-vendor-02.png',
  'kyc-delivery-01.png',
  'kyc-delivery-02.png',
  'stripe-01.png',
  'stripe-02.png',
]);

/** Repli générique si le fichier exact n’existe pas sur le site vitrine. */
export const EMAIL_WEB_FALLBACK_PATH = '/images/email/fallback.png';

export function isEmailStorageObjectUrl(url: string): boolean {
  return (
    url.includes('firebasestorage.googleapis.com') ||
    url.includes('storage.googleapis.com') ||
    url.includes('/medias/public/') ||
    url.includes('.s3.') ||
    url.includes('s3.amazonaws.com')
  );
}

function normalizeWebBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Hosts historiques du site vitrine (ex. web.wise-eat.com → 502) → canonique.
 * Fix: e-mails onboarding affichaient des images cassées car EMAIL_WEBSITE_URL
 * pointait vers un sous-domaine hors service alors que les assets sont sur wise-eat.com.
 */
const EMAIL_WEBSITE_HOST_ALIASES: Record<string, string> = {
  'web.wise-eat.com': 'wise-eat.com',
  'www.wise-eat.com': 'wise-eat.com',
};

/** Normalise la base vitrine (alias host + trailing slash). */
export function canonicalizeEmailWebsiteUrl(raw: string): string {
  const normalized = normalizeWebBase(raw);
  try {
    const u = new URL(normalized);
    const mapped = EMAIL_WEBSITE_HOST_ALIASES[u.hostname.toLowerCase()];
    if (mapped) {
      u.hostname = mapped;
      return normalizeWebBase(u.toString());
    }
  } catch {
    // URL non parseable : on garde le trim tel quel.
  }
  return normalized;
}

export function emailWebFallbackUrl(websiteBase: string): string {
  return `${canonicalizeEmailWebsiteUrl(websiteBase)}${EMAIL_WEB_FALLBACK_PATH}`;
}

/**
 * URL publique du site vitrine pour les assets e-mail (africa-meals-web).
 */
export function resolveEmailWebSiteBase(
  config: ConfigService | { get: (key: string) => string | undefined },
): string {
  const get = (key: string) => config.get(key);
  const keys = [
    'EMAIL_WEBSITE_URL',
    'PUBLIC_WEB_URL',
    'WEBSITE_URL',
    'FRONTEND_URL',
  ];
  for (const key of keys) {
    const v = get(key)?.trim();
    // Canoniser tout de suite pour que hero / sections pointent vers wise-eat.com.
    if (v) return canonicalizeEmailWebsiteUrl(v);
  }
  const brand = resolveEmailBrand(config);
  if (brand.websiteUrl) return canonicalizeEmailWebsiteUrl(brand.websiteUrl);
  return 'https://wise-eat.com';
}

function webAsset(base: string, path: string): string {
  return `${normalizeWebBase(base)}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Mappe un chemin objet GCS/Firebase/proxy vers une URL statique sur le site vitrine.
 * Ne retourne jamais d’URL GCS/Firebase (compte legacy supprimé).
 */
export function mapEmailObjectPathToWebUrl(
  objectPath: string,
  websiteBase: string,
): string {
  const norm = objectPath.replace(/^\/+/, '').trim();
  // Même canonisation que resolveEmailWebSiteBase (assets toujours sur le host live).
  const base = canonicalizeEmailWebsiteUrl(websiteBase);

  if (!norm) {
    return emailWebFallbackUrl(base);
  }

  if (
    norm === 'platform-theme/logo.png' ||
    norm.endsWith('/platform-theme/logo.png') ||
    norm.startsWith('platform-theme/logo.')
  ) {
    return webAsset(base, '/logo.png');
  }

  if (norm.startsWith('platform-theme/')) {
    const file = norm.split('/').pop() ?? '';
    if (file) {
      return webAsset(base, `/images/platform-theme/${file}`);
    }
    return webAsset(base, '/logo.png');
  }

  if (norm.startsWith('help/')) {
    const file = norm.split('/').pop() ?? '';
    if (EMAIL_HELP_FILES.has(file)) {
      return webAsset(base, `/images/help/${file}`);
    }
    return webAsset(base, '/images/help/help-section-01.png');
  }

  if (norm.startsWith('onboarding-sections/')) {
    const file = norm.split('/').pop() ?? '';
    if (EMAIL_ONBOARDING_FILES.has(file)) {
      return webAsset(base, `/images/onboarding-sections/${file}`);
    }
    return webAsset(base, '/images/onboarding-sections/kyc-vendor-01.png');
  }

  if (norm.startsWith('email-heroes/')) {
    const file = norm.split('/').pop() ?? '';
    if (EMAIL_HERO_FILES.has(file)) {
      return webAsset(base, `/images/email-heroes/${file}`);
    }
    if (norm.includes('/vendor/') || norm.includes('vendor-onboarding')) {
      return webAsset(base, '/images/email-heroes/vendor-onboarding-01.png');
    }
    if (norm.includes('/delivery/') || norm.includes('delivery-onboarding')) {
      return webAsset(base, '/images/email-heroes/delivery-onboarding-01.png');
    }
    if (norm.includes('ad-cash')) {
      return webAsset(base, '/images/email-heroes/vendor-onboarding-01.png');
    }
    if (/\.(png|jpe?g|webp)$/i.test(file)) {
      return webAsset(base, `/images/email-heroes/${file}`);
    }
    return webAsset(base, '/images/email-heroes/vendor-onboarding-01.png');
  }

  if (norm === 'maintenance-mode-on.png' || norm === 'maintenance-mode-off.png') {
    return webAsset(base, `/images/email-heroes/${norm}`);
  }

  if (norm.startsWith('catalog/') || norm.startsWith('products/')) {
    const file = norm.split('/').pop() ?? '';
    if (file === 'meal.jpg') {
      return webAsset(base, '/images/email/catalog/meal.jpg');
    }
    return webAsset(base, '/images/email/catalog/product-placeholder.jpg');
  }

  if (
    norm.includes('/products/') ||
    norm.includes('/extras/') ||
    norm.includes('/categories/')
  ) {
    return webAsset(base, '/images/email/catalog/product-placeholder.jpg');
  }

  if (norm.startsWith('drinks/') || norm.includes('/drinks/')) {
    return webAsset(base, '/images/email/drinks/drink-placeholder.jpg');
  }

  if (norm.startsWith('stores/') || norm.includes('/stores/')) {
    return webAsset(base, '/images/email/stores/store-placeholder.png');
  }

  if (
    norm.startsWith('marketing/') ||
    norm.includes('/offers/') ||
    norm.startsWith('offers/')
  ) {
    return webAsset(base, '/images/email/ads/ad-placeholder.png');
  }

  if (
    norm.startsWith('gift') ||
    norm.includes('gift_code') ||
    norm.includes('gift-codes') ||
    norm.includes('gift_codes')
  ) {
    return webAsset(base, '/images/email/gifts/gift-placeholder.png');
  }

  if (norm.startsWith('ads/') || norm.includes('/ads/')) {
    return webAsset(base, '/images/email/ads/ad-placeholder.png');
  }

  if (
    norm.startsWith('blog/') ||
    norm.includes('featured') ||
    norm.includes('blog_')
  ) {
    return webAsset(base, '/images/email/blog/blog-placeholder.jpg');
  }

  if (norm.startsWith('announcements/') || norm.startsWith('legal/')) {
    return webAsset(base, '/images/email/ads/ad-placeholder.png');
  }

  if (norm.startsWith('users/') || norm.includes('/users/')) {
    return webAsset(base, '/images/email/fallback.png');
  }

  if (norm.startsWith('vendor_guides/') || norm.includes('vendor-guides')) {
    return webAsset(base, '/images/email/blog/blog-placeholder.jpg');
  }

  if (norm.startsWith('app-policies/') || norm.includes('app_policies')) {
    return webAsset(base, '/images/email/blog/blog-placeholder.jpg');
  }

  return emailWebFallbackUrl(base);
}

/**
 * Réécrit toute URL Firebase/GCS/proxy vers le site vitrine (jamais GCS).
 */
export function resolveEmailWebAssetUrl(
  url: string | null | undefined,
  websiteBase: string,
): string | undefined {
  if (!url?.trim()) return undefined;
  // 1. Base canonique (évite web.wise-eat.com dans les src img).
  const base = canonicalizeEmailWebsiteUrl(websiteBase);
  // 2. Réécrire aussi l’URL source si elle pointe encore vers un alias mort.
  const raw = canonicalizeEmailWebsiteUrl(url.trim());

  if (
    raw.startsWith(`${base}/images/`) ||
    raw === `${base}/logo.png` ||
    raw.includes('/images/email-heroes/') ||
    raw.includes('/images/help/') ||
    raw.includes('/images/onboarding-sections/') ||
    raw.includes('/images/email/')
  ) {
    return raw;
  }

  if (!isEmailStorageObjectUrl(raw)) {
    if (/^https?:\/\//i.test(raw)) return raw;
    return undefined;
  }

  try {
    const objectPath = extractObjectPath(raw);
    return mapEmailObjectPathToWebUrl(objectPath, base);
  } catch {
    return emailWebFallbackUrl(base);
  }
}

/** Résolution e-mail : site vitrine uniquement (pas de repli GCS/Firebase). */
export async function resolveEmailImageUrl(
  url: string | null | undefined,
  websiteBase: string,
  _fallback?: (url: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  if (!url?.trim()) return undefined;
  const raw = url.trim();
  const web = resolveEmailWebAssetUrl(raw, websiteBase);
  if (web) return web;
  if (/^https?:\/\//i.test(raw)) return raw;
  return emailWebFallbackUrl(websiteBase);
}
