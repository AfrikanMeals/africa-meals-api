import {
  EMAIL_ENGINE_ANY,
  EMAIL_ENGINE_AUTO,
  EMAIL_ENGINE_BIRD,
  EMAIL_ENGINE_DEFAULT,
  EMAIL_ENGINE_RESEND,
  EMAIL_ENGINE_SENDGRID,
} from './email-engine.util';
import { buildEmailEngineAttemptChain } from './email-engine-chain.util';
import type { EmailEngineRuntimeContext } from './email-send.types';

describe('buildEmailEngineAttemptChain', () => {
  const baseCtx: EmailEngineRuntimeContext = {
    globalEngine: EMAIL_ENGINE_ANY,
    defaultSmtpConfigured: true,
    birdEmailConfigured: true,
    resendConfigured: true,
    sendgridConfigured: false,
    configuredSmtpConfigIds: ['cfg1'],
    mailerSendConfigured: true,
  };

  it('starts with selected engine then tries remaining configured engines', () => {
    const chain = buildEmailEngineAttemptChain({
      selectedEngine: EMAIL_ENGINE_RESEND,
      ctx: baseCtx,
    });
    expect(chain[0]).toBe(EMAIL_ENGINE_RESEND);
    expect(chain).toContain(EMAIL_ENGINE_DEFAULT);
    expect(chain).toContain(EMAIL_ENGINE_BIRD);
    expect(chain).toContain('smtp:cfg1');
    expect(new Set(chain).size).toBe(chain.length);
    expect(chain.at(-1)).toBe('mailersend');
  });

  it('uses only smtp engines for auto selection primary pool', () => {
    const chain = buildEmailEngineAttemptChain({
      selectedEngine: EMAIL_ENGINE_AUTO,
      ctx: baseCtx,
    });
    const smtpEngines = [EMAIL_ENGINE_DEFAULT, 'smtp:cfg1'];
    expect(smtpEngines).toContain(chain[0]);
    expect(chain).toContain(EMAIL_ENGINE_BIRD);
  });

  it('falls back to mailersend when no platform engines configured', () => {
    const chain = buildEmailEngineAttemptChain({
      selectedEngine: EMAIL_ENGINE_ANY,
      ctx: {
        ...baseCtx,
        defaultSmtpConfigured: false,
        birdEmailConfigured: false,
        resendConfigured: false,
        configuredSmtpConfigIds: [],
      },
    });
    expect(chain).toEqual(['mailersend']);
  });
});
