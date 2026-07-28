import { parseGainEstimateLlmJson } from './gain-estimate-llm.service';

describe('parseGainEstimateLlmJson', () => {
  it('parse JSON valide', () => {
    const ai = parseGainEstimateLlmJson(
      JSON.stringify({
        summary: 'Rentable grâce aux commissions.',
        suggestions: ['Augmenter Ad Credit', 'Revoir free tier'],
      }),
      'fr',
    );
    expect(ai?.source).toBe('llm');
    expect(ai?.summary).toContain('Rentable');
    expect(ai?.suggestions).toHaveLength(2);
  });

  it('accepte fence markdown ```json', () => {
    const ai = parseGainEstimateLlmJson(
      '```json\n{"summary":"OK","suggestions":["A"]}\n```',
      'en',
    );
    expect(ai?.summary).toBe('OK');
    expect(ai?.suggestions).toEqual(['A']);
  });

  it('retourne null si summary manquant', () => {
    expect(parseGainEstimateLlmJson('{"suggestions":["x"]}', 'fr')).toBeNull();
    expect(parseGainEstimateLlmJson('not-json', 'fr')).toBeNull();
  });
});
