/** Affichage carte / liste : jamais d’URL brute dans [avatar]. */
export function resolveDashboardLivreurAvatar(
  fullName: string | undefined,
  rawAvatarOrProfileUrl: string | undefined,
): { avatar: string; profileImageUrl: string | null } {
  const raw = (rawAvatarOrProfileUrl ?? '').trim();
  const isUrl = /^https?:\/\//i.test(raw) || raw.startsWith('//');
  const profileImageUrl = isUrl ? raw : null;

  const name = (fullName ?? '').trim();
  let glyph = '🛵';
  if (name.length >= 2) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = parts[0]?.charAt(0) ?? '';
      const b = parts[parts.length - 1]?.charAt(0) ?? '';
      glyph = (a + b).toUpperCase();
    } else if (parts[0] != null) {
      glyph = parts[0].slice(0, 2).toUpperCase();
    }
  }

  if (!isUrl && raw.length > 0 && raw.length <= 8 && !/[./\\]/.test(raw)) {
    return { avatar: raw, profileImageUrl: null };
  }

  return { avatar: glyph, profileImageUrl };
}
