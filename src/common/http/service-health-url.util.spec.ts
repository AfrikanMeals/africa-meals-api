import {
  normalizeServiceBaseUrl,
  serviceApiSubpath,
  serviceHealthUrl,
} from './service-health-url.util';

describe('service-health-url.util', () => {
  describe('normalizeServiceBaseUrl', () => {
    it('strips trailing /api and /api/health', () => {
      expect(normalizeServiceBaseUrl('http://localhost:9001/api')).toBe(
        'http://localhost:9001',
      );
      expect(normalizeServiceBaseUrl('http://localhost:9001/api/')).toBe(
        'http://localhost:9001',
      );
      expect(normalizeServiceBaseUrl('http://localhost:9001/api/health')).toBe(
        'http://localhost:9001',
      );
    });

    it('returns empty for blank input', () => {
      expect(normalizeServiceBaseUrl('')).toBe('');
      expect(normalizeServiceBaseUrl('   ')).toBe('');
    });
  });

  describe('serviceHealthUrl', () => {
    it('appends /api/health without doubling /api', () => {
      expect(serviceHealthUrl('http://localhost:9001')).toBe(
        'http://localhost:9001/api/health',
      );
      expect(serviceHealthUrl('http://localhost:9001/api')).toBe(
        'http://localhost:9001/api/health',
      );
      expect(serviceHealthUrl('http://localhost:9001/api/')).toBe(
        'http://localhost:9001/api/health',
      );
    });

    it('normalizes existing health path', () => {
      expect(serviceHealthUrl('http://localhost:9001/api/health')).toBe(
        'http://localhost:9001/api/health',
      );
    });

    it('uses fallback when base is empty', () => {
      expect(serviceHealthUrl('')).toBe('http://localhost:9000/api/health');
      expect(serviceHealthUrl('', 'http://fallback/api/health')).toBe(
        'http://fallback/api/health',
      );
    });
  });

  describe('serviceApiSubpath', () => {
    it('builds subpath under /api without doubling prefix', () => {
      expect(serviceApiSubpath('http://localhost:8001', 'sse/public/status')).toBe(
        'http://localhost:8001/api/sse/public/status',
      );
      expect(
        serviceApiSubpath('http://localhost:8001/api', 'sse/public/status'),
      ).toBe('http://localhost:8001/api/sse/public/status');
    });
  });
});
