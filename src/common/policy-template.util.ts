/** Remplace `{{cle}}` dans un texte par les valeurs fournies (insensible à la casse des clés). */
export function interpolatePolicyTemplate(
  raw: string,
  vars: Record<string, string | number | undefined | null>,
): string {
  if (!raw) return '';
  const normalized = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) {
    normalized.set(k.trim().toLowerCase(), String(v ?? '').trim());
  }
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = normalized.get(String(key).toLowerCase());
    return value ?? '';
  });
}

export function interpolatePolicyFields<
  T extends {
    title?: string;
    description?: string;
    sections?: Array<{ title?: string; htmlContent?: string }>;
  },
>(doc: T, vars: Record<string, string | number | undefined | null>): T {
  const title = interpolatePolicyTemplate(doc.title ?? '', vars);
  const description = interpolatePolicyTemplate(doc.description ?? '', vars);
  const sections = (doc.sections ?? []).map((s) => ({
    ...s,
    title: interpolatePolicyTemplate(s.title ?? '', vars),
    htmlContent: interpolatePolicyTemplate(s.htmlContent ?? '', vars),
  }));
  return { ...doc, title, description, sections };
}
