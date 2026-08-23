import {
  API_X_ROBOTS_TAG_VALUE,
  isNoindexRobotsTag,
} from './x-robots-tag.util';
import { xRobotsTagMiddleware } from './x-robots-tag.middleware';
import type { Request } from 'express';
import type { MiddlewareResponse } from '@common/http/http-response.util';

describe('x-robots-tag', () => {
  it('uses noindex, nofollow (API is not a search surface)', () => {
    expect(API_X_ROBOTS_TAG_VALUE).toBe('noindex, nofollow');
    expect(isNoindexRobotsTag(API_X_ROBOTS_TAG_VALUE)).toBe(true);
    expect(isNoindexRobotsTag('index, follow')).toBe(false);
  });

  it('middleware sets X-Robots-Tag then calls next', () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    } as MiddlewareResponse;
    let nextCalled = false;
    xRobotsTagMiddleware()({} as Request, res, () => {
      nextCalled = true;
    });
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(nextCalled).toBe(true);
  });
});
