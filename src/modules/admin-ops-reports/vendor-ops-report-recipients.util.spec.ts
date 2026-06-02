import { collectStoreCcEmails } from './vendor-ops-report-cc.util';

describe('collectStoreCcEmails', () => {
  it('inclut les e-mails boutique distincts du propriétaire', () => {
    expect(
      collectStoreCcEmails('owner@test.com', [
        'resto@test.com',
        'resto2@test.com',
      ]),
    ).toEqual(['resto@test.com', 'resto2@test.com']);
  });

  it('exclut doublons et e-mail propriétaire', () => {
    expect(
      collectStoreCcEmails('owner@test.com', [
        'owner@test.com',
        'resto@test.com',
        'resto@test.com',
      ]),
    ).toEqual(['resto@test.com']);
  });
});
