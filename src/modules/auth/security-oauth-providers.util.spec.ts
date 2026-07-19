import { deriveSecurityOauthProviders } from './security-oauth-providers.util';

describe('deriveSecurityOauthProviders', () => {
  it('retourne les providers liés dans l’ordre google → apple → facebook', () => {
    expect(
      deriveSecurityOauthProviders({
        googleId: 'g1',
        appleId: ' a ',
        facebookId: 'f1',
      }),
    ).toEqual(['google', 'apple', 'facebook']);
  });

  it('ignore ids vides', () => {
    expect(
      deriveSecurityOauthProviders({
        googleId: '',
        appleId: null,
        facebookId: '  ',
      }),
    ).toEqual([]);
  });

  it('google seul', () => {
    expect(deriveSecurityOauthProviders({ googleId: 'x' })).toEqual(['google']);
  });
});
