import type { Request } from 'express';
import {
  buildDryRunSimulatedResponse,
  isDryRunAlwaysExecutePath,
  isDryRunRequest,
  isGraphqlMutationRequest,
  shouldSimulateDryRunMutation,
} from './dry-run.util';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    headers: {},
    query: {},
    body: {},
    originalUrl: '/api/cart',
    url: '/api/cart',
    ...overrides,
  } as Request;
}

describe('dry-run.util', () => {
  const cfg = { enabled: true, secret: 'test-secret' };

  it('activates only with flag + valid token', () => {
    expect(
      isDryRunRequest(
        mockReq({
          headers: {
            'x-wise-eat-dry-run': '1',
            'x-wise-eat-dry-run-token': 'test-secret',
          },
        }),
        cfg,
      ),
    ).toBe(true);
    expect(
      isDryRunRequest(
        mockReq({
          headers: { 'x-wise-eat-dry-run': '1' },
        }),
        cfg,
      ),
    ).toBe(false);
  });

  it('exempts webhooks and auth login', () => {
    expect(isDryRunAlwaysExecutePath('/api/billing/stripe/webhook')).toBe(true);
    expect(isDryRunAlwaysExecutePath('/api/auth/login')).toBe(true);
    expect(isDryRunAlwaysExecutePath('/api/cart')).toBe(false);
  });

  it('simulates POST mutations but not GET', () => {
    expect(
      shouldSimulateDryRunMutation(
        mockReq({ method: 'GET' }),
        '/api/cart',
        'GET',
      ),
    ).toBe(false);
    expect(
      shouldSimulateDryRunMutation(
        mockReq({ method: 'POST' }),
        '/api/cart',
        'POST',
      ),
    ).toBe(true);
  });

  it('passes through GraphQL queries', () => {
    const req = mockReq({
      method: 'POST',
      originalUrl: '/api/graphql',
      body: { query: 'query { shopHome { id } }' },
    });
    expect(
      shouldSimulateDryRunMutation(req, '/api/graphql', 'POST'),
    ).toBe(false);
    expect(isGraphqlMutationRequest(req)).toBe(false);
  });

  it('simulates GraphQL mutations', () => {
    const req = mockReq({
      method: 'POST',
      originalUrl: '/api/graphql',
      body: { query: 'mutation { trackPushRecommendation(input: {}) { ok } }' },
    });
    expect(
      shouldSimulateDryRunMutation(req, '/api/graphql', 'POST'),
    ).toBe(true);
  });

  it('builds status codes for simulated responses', () => {
    expect(buildDryRunSimulatedResponse('POST', '/api/orders').status).toBe(201);
    expect(buildDryRunSimulatedResponse('DELETE', '/api/cart/1').status).toBe(204);
    expect(buildDryRunSimulatedResponse('PATCH', '/api/cart/1').status).toBe(200);
  });
});
