/**
 * Règles pures App Versioning (gate mobile).
 * Comparaison = build number entier ; versionNumber = libellé affichage.
 */

/** Client outdated si minBuildId numérique et clientBuild < min. */
export function isAppVersionOutdated(params: {
  clientBuild: number | string | null | undefined;
  minBuildId: string | null | undefined;
}): boolean {
  const minRaw = String(params.minBuildId ?? '').trim();
  if (!minRaw) return false;
  const min = Number.parseInt(minRaw, 10);
  if (!Number.isFinite(min) || min <= 0) return false;

  const client =
    typeof params.clientBuild === 'number'
      ? params.clientBuild
      : Number.parseInt(String(params.clientBuild ?? '').trim(), 10);
  if (!Number.isFinite(client)) return false;
  return client < min;
}

/**
 * Jours restants jusqu’à `updateBefore` (date jour, UTC midnight fin de journée locale ignorée).
 * Retourne null si date absente / invalide.
 */
export function remainingUpdateDays(
  updateBefore: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const raw = String(updateBefore ?? '').trim();
  if (!raw) return null;
  // Accepte YYYY-MM-DD ou ISO datetime.
  const day = raw.length >= 10 ? raw.slice(0, 10) : raw;
  const end = new Date(`${day}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export type AppPlatformVersionConfigNormalized = {
  versionNumber: string;
  buildId: string;
  /** Miroir FR||EN pour clients legacy. */
  whatsNewHtml: string;
  whatsNewHtmlFr: string;
  whatsNewHtmlEn: string;
  required: boolean;
  updateBefore: string | null;
};

export type AppVersioningNormalized = {
  android: AppPlatformVersionConfigNormalized;
  ios: AppPlatformVersionConfigNormalized;
};

export function emptyPlatformVersionConfig(): AppPlatformVersionConfigNormalized {
  return {
    versionNumber: '',
    buildId: '',
    whatsNewHtml: '',
    whatsNewHtmlFr: '',
    whatsNewHtmlEn: '',
    required: false,
    updateBefore: null,
  };
}

export function emptyAppVersioning(): AppVersioningNormalized {
  return {
    android: emptyPlatformVersionConfig(),
    ios: emptyPlatformVersionConfig(),
  };
}

/**
 * Résout FR/EN + legacy monolingue.
 * - Si FR/EN vides et legacy présent → remplit les deux locales (migration).
 * - `whatsNewHtml` = FR || EN (compat anciens clients mobile).
 */
export function resolveWhatsNewHtmlFields(raw: {
  whatsNewHtml?: unknown;
  whatsNewHtmlFr?: unknown;
  whatsNewHtmlEn?: unknown;
}): {
  whatsNewHtml: string;
  whatsNewHtmlFr: string;
  whatsNewHtmlEn: string;
} {
  const legacy = String(raw.whatsNewHtml ?? '').trim();
  let fr = String(raw.whatsNewHtmlFr ?? '').trim();
  let en = String(raw.whatsNewHtmlEn ?? '').trim();
  // Migration docs/admin monolingues : un seul HTML → les deux locales.
  if (!fr && !en && legacy) {
    fr = legacy;
    en = legacy;
  }
  // Miroir legacy pour clients qui ne lisent que whatsNewHtml.
  const whatsNewHtml = fr || en || legacy;
  return { whatsNewHtml, whatsNewHtmlFr: fr, whatsNewHtmlEn: en };
}

/** Normalise un slot plateforme depuis JSON / DTO. */
export function normalizePlatformVersionConfig(
  raw: unknown,
): AppPlatformVersionConfigNormalized {
  const o =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const versionNumber = String(o.versionNumber ?? '').trim();
  const buildId = String(o.buildId ?? '').trim();
  const { whatsNewHtml, whatsNewHtmlFr, whatsNewHtmlEn } =
    resolveWhatsNewHtmlFields(o);
  const required = o.required === true;
  let updateBefore: string | null = null;
  const ub = o.updateBefore;
  if (ub != null && String(ub).trim()) {
    const s = String(ub).trim();
    updateBefore = s.length >= 10 ? s.slice(0, 10) : s;
  }
  return {
    versionNumber,
    buildId,
    whatsNewHtml,
    whatsNewHtmlFr,
    whatsNewHtmlEn,
    required,
    updateBefore,
  };
}

/** Normalise le bloc appVersioning (défauts vides). */
export function normalizeAppVersioning(raw: unknown): AppVersioningNormalized {
  const o =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    android: normalizePlatformVersionConfig(o.android),
    ios: normalizePlatformVersionConfig(o.ios),
  };
}
