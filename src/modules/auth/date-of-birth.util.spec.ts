import {
  ageYearsFromDateOfBirth,
  formatDateOfBirthIso,
  parseOptionalDateOfBirth,
} from './date-of-birth.util'

describe('date-of-birth.util', () => {
  it('accepte YYYY-MM-DD et refuse futur / invalide', () => {
    expect(parseOptionalDateOfBirth('')).toEqual({ ok: true, value: null })
    expect(parseOptionalDateOfBirth(null)).toEqual({ ok: true, value: null })
    const ok = parseOptionalDateOfBirth('2010-05-12')
    expect(ok.ok).toBe(true)
    if (ok.ok && ok.value) {
      expect(formatDateOfBirthIso(ok.value)).toBe('2010-05-12')
    }
    expect(parseOptionalDateOfBirth('2010-13-01').ok).toBe(false)
    expect(parseOptionalDateOfBirth('not-a-date').ok).toBe(false)
    const futureYear = new Date().getUTCFullYear() + 1
    expect(parseOptionalDateOfBirth(`${futureYear}-01-01`).ok).toBe(false)
  })

  it('calcule l’âge révolu', () => {
    const dob = new Date(Date.UTC(2010, 0, 1, 12))
    const now = new Date(Date.UTC(2026, 6, 21, 12))
    expect(ageYearsFromDateOfBirth(dob, now)).toBe(16)
    expect(ageYearsFromDateOfBirth(null)).toBeNull()
  })
})
