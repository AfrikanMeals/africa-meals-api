/**
 * Date de naissance profil (optionnelle) — contrôle parental.
 * Entrée : `YYYY-MM-DD` ou vide ; sortie Date UTC midi ou null (effacer).
 */

const MIN_YEAR = 1900

export type ParseDateOfBirthResult =
  | { ok: true; value: Date | null }
  | { ok: false; code: 'dateOfBirth_invalid' | 'dateOfBirth_future' }

/**
 * Parse une DOB profil. Chaîne vide / null → effacer (null).
 * Refuse dates invalides ou futures.
 */
export function parseOptionalDateOfBirth(
  raw: unknown,
): ParseDateOfBirthResult {
  if (raw == null) return { ok: true, value: null }
  const s = String(raw).trim()
  if (!s) return { ok: true, value: null }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return { ok: false, code: 'dateOfBirth_invalid' }

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (
    !Number.isFinite(year) ||
    year < MIN_YEAR ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return { ok: false, code: 'dateOfBirth_invalid' }
  }

  // Midi UTC : évite les décalages fuseau sur le jour calendaire.
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return { ok: false, code: 'dateOfBirth_invalid' }
  }

  const today = new Date()
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    12,
    0,
    0,
  )
  if (d.getTime() > todayUtc) {
    return { ok: false, code: 'dateOfBirth_future' }
  }

  return { ok: true, value: d }
}

/** Âge révolu en années (UTC) — null si DOB absente. */
export function ageYearsFromDateOfBirth(
  dob: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!dob || Number.isNaN(dob.getTime())) return null
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const m = now.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1
  }
  return age < 0 ? 0 : age
}

/** Sérialise Date → `YYYY-MM-DD` pour clients. */
export function formatDateOfBirthIso(dob: Date | null | undefined): string | null {
  if (!dob || Number.isNaN(dob.getTime())) return null
  const y = dob.getUTCFullYear()
  const mo = String(dob.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dob.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}
