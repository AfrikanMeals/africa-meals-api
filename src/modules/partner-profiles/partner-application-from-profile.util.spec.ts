import { buildPartnerApplicationNotesFromProfile } from './partner-application-from-profile.util';

describe('buildPartnerApplicationNotesFromProfile', () => {
  it('inclut identité et adresse', () => {
    const notes = buildPartnerApplicationNotesFromProfile({
      displayName: 'Ada Lovelace',
      address: '12 Rue X, Douala',
    });
    expect(notes).toContain('fiche partenaire');
    expect(notes).toContain('Ada Lovelace');
    expect(notes).toContain('Douala');
    expect(notes.length).toBeGreaterThanOrEqual(10);
  });

  it('reste ≥ 10 chars sans adresse', () => {
    const notes = buildPartnerApplicationNotesFromProfile({
      displayName: 'Bo',
      address: '',
    });
    expect(notes.length).toBeGreaterThanOrEqual(10);
  });
});
