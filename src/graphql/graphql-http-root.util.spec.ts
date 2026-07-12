import { graphqlHttpDriverName } from './graphql-http-root.util';

describe('graphqlHttpDriverName', () => {
  const prev = process.env.API_HTTP_ADAPTER;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.API_HTTP_ADAPTER;
    } else {
      process.env.API_HTTP_ADAPTER = prev;
    }
  });

  it('choisit mercurius sous Fastify', () => {
    process.env.API_HTTP_ADAPTER = 'fastify';
    expect(graphqlHttpDriverName()).toBe('mercurius');
  });

  it('choisit apollo hors Fastify (Express / Functions)', () => {
    delete process.env.API_HTTP_ADAPTER;
    expect(graphqlHttpDriverName()).toBe('apollo');
  });
});
