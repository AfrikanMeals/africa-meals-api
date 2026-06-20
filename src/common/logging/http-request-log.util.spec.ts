import {
  colorForHttpStatus,
  formatHttpRequestLogLine,
  httpLogLevelForStatus,
  isHttpBodyLoggingEnabled,
  isHttpRequestLoggingEnabled,
} from './http-request-log.util';

describe('http-request-log.util', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('détermine le niveau de log selon le status HTTP', () => {
    expect(httpLogLevelForStatus(200)).toBe('info');
    expect(httpLogLevelForStatus(404)).toBe('warn');
    expect(httpLogLevelForStatus(500)).toBe('error');
  });

  it('colore le status HTTP par plage', () => {
    expect(colorForHttpStatus(201)).toContain('\x1b[32m');
    expect(colorForHttpStatus(404)).toContain('\x1b[33m');
    expect(colorForHttpStatus(503)).toContain('\x1b[31m');
  });

  it('formate une ligne sans couleur', () => {
    const line = formatHttpRequestLogLine({
      method: 'get',
      url: '/api/health',
      status: 200,
      durationMs: 4.2,
      useColors: false,
    });
    expect(line).toBe('[HTTP] GET /api/health 200 4ms');
  });

  it('formate une ligne avec couleur et suffixe body', () => {
    const line = formatHttpRequestLogLine({
      method: 'POST',
      url: '/api/auth/login',
      status: 401,
      durationMs: 12.7,
      bodySuffix: ' body: (no body)',
      useColors: true,
    });
    expect(line).toContain('[HTTP]');
    expect(line).toContain('POST');
    expect(line).toContain('/api/auth/login');
    expect(line).toContain('401');
    expect(line).toContain('13ms');
    expect(line).toContain('body: (no body)');
  });

  it('active le log body seulement si LOG_HTTP_BODIES=true', () => {
    delete process.env.LOG_HTTP_BODIES;
    expect(isHttpBodyLoggingEnabled()).toBe(false);
    process.env.LOG_HTTP_BODIES = 'true';
    process.env.NODE_ENV = 'development';
    expect(isHttpBodyLoggingEnabled()).toBe(true);
  });

  it('active le log requête en dev par défaut', () => {
    delete process.env.LOG_HTTP_REQUESTS;
    delete process.env.LOG_HTTP_BODIES;
    process.env.NODE_ENV = 'development';
    expect(isHttpRequestLoggingEnabled()).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(isHttpRequestLoggingEnabled()).toBe(false);
  });
});
