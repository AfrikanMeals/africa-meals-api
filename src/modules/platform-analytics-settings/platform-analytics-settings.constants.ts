/** Clés toggles analytics — admin portail. */
export const PLATFORM_ANALYTICS_ADMIN_KEYS = [
  'matomo',
  'ga',
  'gtm',
  'fbPixel',
] as const;

export type PlatformAnalyticsAdminKey =
  (typeof PLATFORM_ANALYTICS_ADMIN_KEYS)[number];

export type PlatformAnalyticsAdminFlags = Record<
  PlatformAnalyticsAdminKey,
  boolean
>;

/** Clés toggles analytics — site vitrine. */
export const PLATFORM_ANALYTICS_WEB_KEYS = [
  'matomo',
  'ga',
  'gtm',
] as const;

export type PlatformAnalyticsWebKey =
  (typeof PLATFORM_ANALYTICS_WEB_KEYS)[number];

export type PlatformAnalyticsWebFlags = Record<
  PlatformAnalyticsWebKey,
  boolean
>;

/** Clés toggles analytics — app mobile. */
export const PLATFORM_ANALYTICS_MOBILE_KEYS = [
  'firebase',
  'gtm',
  'facebook',
] as const;

export type PlatformAnalyticsMobileKey =
  (typeof PLATFORM_ANALYTICS_MOBILE_KEYS)[number];

export type PlatformAnalyticsMobileFlags = Record<
  PlatformAnalyticsMobileKey,
  boolean
>;

export const DEFAULT_PLATFORM_ANALYTICS_ADMIN: PlatformAnalyticsAdminFlags = {
  matomo: true,
  ga: true,
  gtm: true,
  fbPixel: true,
};

export const DEFAULT_PLATFORM_ANALYTICS_WEB: PlatformAnalyticsWebFlags = {
  matomo: true,
  ga: true,
  gtm: true,
};

export const DEFAULT_PLATFORM_ANALYTICS_MOBILE: PlatformAnalyticsMobileFlags = {
  firebase: true,
  gtm: true,
  facebook: true,
};
