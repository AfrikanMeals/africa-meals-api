import {
  EMAIL_ENGINE_ANY,
  EMAIL_ENGINE_AUTO,
  EMAIL_ENGINE_BIRD,
  EMAIL_ENGINE_DEFAULT,
  EMAIL_ENGINE_RESEND,
  EMAIL_ENGINE_SENDGRID,
  EMAIL_ENGINE_MAILERSEND,
  isSmtpEngineValue,
} from './email-engine.util';
import type { EmailEngineRuntimeContext } from './email-send.types';

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function listConfiguredConcreteEngines(
  ctx: EmailEngineRuntimeContext,
): string[] {
  const engines: string[] = [];
  if (ctx.defaultSmtpConfigured) engines.push(EMAIL_ENGINE_DEFAULT);
  for (const id of ctx.configuredSmtpConfigIds) {
    engines.push(`smtp:${id}`);
  }
  if (ctx.birdEmailConfigured) engines.push(EMAIL_ENGINE_BIRD);
  if (ctx.resendConfigured) engines.push(EMAIL_ENGINE_RESEND);
  if (ctx.sendgridConfigured) engines.push(EMAIL_ENGINE_SENDGRID);
  if (ctx.mailerSendConfigured) engines.push(EMAIL_ENGINE_MAILERSEND);
  return engines;
}

function isConcreteEngineConfigured(
  engine: string,
  ctx: EmailEngineRuntimeContext,
): boolean {
  return listConfiguredConcreteEngines(ctx).includes(engine);
}

function smtpEngines(ctx: EmailEngineRuntimeContext): string[] {
  return listConfiguredConcreteEngines(ctx).filter(
    (engine) => engine === EMAIL_ENGINE_DEFAULT || isSmtpEngineValue(engine),
  );
}

/** Ordre d’essai : moteur sélectionné puis bascule sur les autres moteurs configurés. */
export function buildEmailEngineAttemptChain(args: {
  selectedEngine: string;
  ctx: EmailEngineRuntimeContext;
}): string[] {
  const all = listConfiguredConcreteEngines(args.ctx);
  if (!all.length) {
    return [];
  }

  let primary: string[] = [];
  const selected = String(args.selectedEngine ?? EMAIL_ENGINE_ANY).trim();

  if (selected === EMAIL_ENGINE_ANY) {
    primary = shuffle(all);
  } else if (selected === EMAIL_ENGINE_AUTO) {
    const pool = smtpEngines(args.ctx);
    primary = shuffle(pool.length > 0 ? pool : all);
  } else if (isConcreteEngineConfigured(selected, args.ctx)) {
    primary = [selected];
  } else {
    primary = shuffle(all);
  }

  const seen = new Set(primary);
  const fallback = all.filter((engine) => !seen.has(engine));
  return [...primary, ...fallback];
}
