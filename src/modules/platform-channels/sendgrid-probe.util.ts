export type SendgridProbeResult = {
  ok: boolean;
  message: string;
  details?: string;
};

/** Vérifie une clé SendGrid via /v3/scopes (compatible clés restreintes mail.send). */
export async function probeSendgridApiKey(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<SendgridProbeResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { ok: false, message: 'SendGrid non configuré.' };
  }

  const headers = { Authorization: `Bearer ${trimmed}` };
  const init = { method: 'GET' as const, headers, signal: AbortSignal.timeout(10_000) };

  try {
    const scopesRes = await fetchFn('https://api.sendgrid.com/v3/scopes', init);

    if (scopesRes.ok) {
      const data = (await scopesRes.json().catch(() => ({}))) as {
        scopes?: string[];
      };
      const scopes = data.scopes ?? [];
      if (scopes.includes('mail.send')) {
        return {
          ok: true,
          message: 'SendGrid configuré (permission mail.send).',
        };
      }
      if (scopes.length > 0) {
        return {
          ok: true,
          message: 'SendGrid configuré (clé valide, permissions limitées).',
          details: `Scopes : ${scopes.slice(0, 8).join(', ')}${scopes.length > 8 ? '…' : ''}`,
        };
      }
      return { ok: true, message: 'SendGrid configuré et valide.' };
    }

    if (scopesRes.status === 401) {
      const data = (await scopesRes.json().catch(() => ({}))) as {
        errors?: Array<{ message?: string }>;
      };
      return {
        ok: false,
        message: 'SendGrid non valide.',
        details:
          data.errors?.[0]?.message ??
          'Clé API invalide, expirée ou révoquée.',
      };
    }

    const accountRes = await fetchFn(
      'https://api.sendgrid.com/v3/user/account',
      init,
    );
    if (accountRes.ok) {
      return { ok: true, message: 'SendGrid configuré et valide.' };
    }

    const accountData = (await accountRes.json().catch(() => ({}))) as {
      message?: string;
      errors?: Array<{ message?: string }>;
    };
    return {
      ok: false,
      message: 'SendGrid non valide.',
      details:
        accountData.errors?.[0]?.message ??
        accountData.message ??
        `SendGrid HTTP ${accountRes.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      message: 'SendGrid non accessible.',
      details: e instanceof Error ? e.message : String(e),
    };
  }
}
