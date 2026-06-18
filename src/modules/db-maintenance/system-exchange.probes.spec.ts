import {
  resolveApiHealthProbeUrl,
} from './system-exchange.probes';

describe('system-exchange.probes', () => {
  describe('resolveApiHealthProbeUrl', () => {
    it('uses /api/health on localhost Nest dev', () => {
      expect(resolveApiHealthProbeUrl('http://localhost:9001')).toBe(
        'http://localhost:9001/api/health',
      );
    });

    it('uses /health on dedicated api host', () => {
      expect(resolveApiHealthProbeUrl('https://api.wise-eat.com')).toBe(
        'https://api.wise-eat.com/health',
      );
      expect(resolveApiHealthProbeUrl('https://api-dev.wise-eat.com')).toBe(
        'https://api-dev.wise-eat.com/health',
      );
    });
  });
});
