import { hasRequestBody, shouldParseJsonBody } from './unified-body-parser';
import type { IncomingMessage } from 'http';

function mockReq(
  partial: Partial<{ method: string; headers: Record<string, string> }>,
): IncomingMessage {
  return {
    method: partial.method ?? 'GET',
    headers: partial.headers ?? {},
  } as IncomingMessage;
}

describe('unified-body-parser rules', () => {
  it('skips body parsing for GET', () => {
    const req = mockReq({ method: 'GET' });
    expect(hasRequestBody(req)).toBe(false);
    expect(shouldParseJsonBody(req)).toBe(false);
  });

  it('parses JSON POST', () => {
    const req = mockReq({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(shouldParseJsonBody(req)).toBe(true);
  });

  it('delegates gzip POST to gzip branch', () => {
    const req = mockReq({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
    });
    expect(shouldParseJsonBody(req)).toBe(false);
  });
});
