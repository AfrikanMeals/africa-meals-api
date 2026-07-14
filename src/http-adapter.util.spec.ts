import {
  configureHttpAdapterForRuntime,
  isFastifyHttpAdapter,
} from './http-adapter.util';

describe('configureHttpAdapterForRuntime', () => {
  const previousAdapter = process.env.API_HTTP_ADAPTER;

  afterEach(() => {
    if (previousAdapter === undefined) {
      delete process.env.API_HTTP_ADAPTER;
    } else {
      process.env.API_HTTP_ADAPTER = previousAdapter;
    }
  });

  it('résout Fastify pour le serveur quand le mode partagé est activé', () => {
    process.env.API_HTTP_ADAPTER = 'both';

    expect(configureHttpAdapterForRuntime('fastify')).toBe('fastify');
    expect(isFastifyHttpAdapter()).toBe(true);
  });

  it('résout Express pour Firebase quand le mode partagé est activé', () => {
    process.env.API_HTTP_ADAPTER = 'both';

    expect(configureHttpAdapterForRuntime('express')).toBe('express');
    expect(isFastifyHttpAdapter()).toBe(false);
  });

  it('utilise le mode partagé par défaut pour sécuriser les deux bootstraps', () => {
    delete process.env.API_HTTP_ADAPTER;

    expect(configureHttpAdapterForRuntime('express')).toBe('express');
  });

  it('refuse de lancer Firebase quand le mode est limité à Fastify', () => {
    process.env.API_HTTP_ADAPTER = 'fastify';

    expect(() => configureHttpAdapterForRuntime('express')).toThrow(
      'désactive le bootstrap express',
    );
  });

  it('refuse une valeur inconnue avant de charger AppModule', () => {
    process.env.API_HTTP_ADAPTER = 'haproxy';

    expect(() => configureHttpAdapterForRuntime('fastify')).toThrow(
      'utiliser fastify, express ou both',
    );
  });
});
