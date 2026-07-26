/**
 * Notes Collaborations dérivées de la fiche (remplace le formulaire libre).
 * Toujours ≥ 10 caractères pour passer la validation candidature.
 */
export function buildPartnerApplicationNotesFromProfile(args: {
  displayName: string;
  address: string;
}): string {
  const name = String(args.displayName ?? '').trim() || 'Partenaire';
  const address = String(args.address ?? '').trim();
  const lines = [
    'Candidature via fiche partenaire.',
    `Identité : ${name}.`,
  ];
  if (address.length >= 5) {
    lines.push(`Adresse : ${address}.`);
  }
  const out = lines.join(' ');
  // Filet si champs très courts.
  return out.length >= 10 ? out : `${out} Dossier soumis.`;
}
