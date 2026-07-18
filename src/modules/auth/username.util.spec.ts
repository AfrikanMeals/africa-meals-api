import {
  isValidUsernameFormat,
  normalizeUsername,
  USERNAME_MAX_LEN,
  USERNAME_MIN_LEN,
} from './username.util';

describe('username.util', () => {
  it('normalizeUsername trim + lowercase ; vide → null', () => {
    expect(normalizeUsername('  Jean_Dupont  ')).toBe('jean_dupont');
    expect(normalizeUsername('@Jean_Dupont')).toBe('jean_dupont');
    expect(normalizeUsername('@@bob')).toBe('bob');
    expect(normalizeUsername('')).toBeNull();
    expect(normalizeUsername('   ')).toBeNull();
    expect(normalizeUsername(null)).toBeNull();
    expect(normalizeUsername(undefined)).toBeNull();
  });

  it('accepte un format valide', () => {
    expect(isValidUsernameFormat('abc')).toBe(true);
    expect(isValidUsernameFormat('jean_dupont')).toBe(true);
    expect(isValidUsernameFormat('a12')).toBe(true);
    expect(isValidUsernameFormat('a' + 'b'.repeat(USERNAME_MAX_LEN - 1))).toBe(
      true,
    );
  });

  it('rejette formats invalides', () => {
    expect(isValidUsernameFormat('ab')).toBe(false); // trop court
    expect(isValidUsernameFormat('1abc')).toBe(false); // chiffre en tête
    expect(isValidUsernameFormat('_abc')).toBe(false);
    expect(isValidUsernameFormat('Jean')).toBe(false); // majuscules (non normalisé)
    expect(isValidUsernameFormat('jean-dupont')).toBe(false);
    expect(isValidUsernameFormat('jean.dupont')).toBe(false);
    expect(isValidUsernameFormat('a' + 'b'.repeat(USERNAME_MAX_LEN))).toBe(
      false,
    );
    expect(isValidUsernameFormat('a'.repeat(USERNAME_MIN_LEN - 1))).toBe(false);
  });
});
