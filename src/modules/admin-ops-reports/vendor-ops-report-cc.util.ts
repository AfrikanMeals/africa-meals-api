function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** E-mails boutique en CC (sans doublon ni e-mail propriétaire). */
export function collectStoreCcEmails(
  ownerEmail: string,
  storeEmails: string[],
): string[] {
  const owner = ownerEmail.trim().toLowerCase();
  const seen = new Set<string>(owner ? [owner] : []);
  const out: string[] = [];
  for (const raw of storeEmails) {
    const e = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (!isValidEmail(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function isValidReportEmail(email: string): boolean {
  return isValidEmail(email.trim().toLowerCase());
}
