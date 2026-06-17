import {
  isGraphqlPlaygroundEnabled,
  isSwaggerEnabled,
} from './api-docs-exposure.util';

describe('api-docs-exposure.util', () => {
  const env = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...env };
    delete process.env.DISABLE_SWAGGER;
    delete process.env.DISABLE_GRAPHQL_PLAYGROUND;
    delete process.env.ENABLE_SWAGGER_IN_PROD;
    delete process.env.ENABLE_GRAPHQL_PLAYGROUND_IN_PROD;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = env;
  });

  describe('isSwaggerEnabled', () => {
    it('désactive en production par défaut', () => {
      process.env.NODE_ENV = 'production';
      expect(isSwaggerEnabled()).toBe(false);
    });

    it('active en production si ENABLE_SWAGGER_IN_PROD=true', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_SWAGGER_IN_PROD = 'true';
      expect(isSwaggerEnabled()).toBe(true);
    });

    it('active en dev par défaut', () => {
      process.env.NODE_ENV = 'development';
      expect(isSwaggerEnabled()).toBe(true);
    });

    it('respecte DISABLE_SWAGGER=true hors prod', () => {
      process.env.NODE_ENV = 'development';
      process.env.DISABLE_SWAGGER = 'true';
      expect(isSwaggerEnabled()).toBe(false);
    });
  });

  describe('isGraphqlPlaygroundEnabled', () => {
    it('désactive playground et introspection en production par défaut', () => {
      process.env.NODE_ENV = 'production';
      expect(isGraphqlPlaygroundEnabled()).toBe(false);
    });

    it('active en production si ENABLE_GRAPHQL_PLAYGROUND_IN_PROD=true', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_GRAPHQL_PLAYGROUND_IN_PROD = 'true';
      expect(isGraphqlPlaygroundEnabled()).toBe(true);
    });

    it('active en dev par défaut', () => {
      process.env.NODE_ENV = 'local';
      expect(isGraphqlPlaygroundEnabled()).toBe(true);
    });

    it('respecte DISABLE_GRAPHQL_PLAYGROUND=true hors prod', () => {
      process.env.NODE_ENV = 'local';
      process.env.DISABLE_GRAPHQL_PLAYGROUND = 'true';
      expect(isGraphqlPlaygroundEnabled()).toBe(false);
    });
  });
});
