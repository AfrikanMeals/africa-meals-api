#!/usr/bin/env node
/**
 * Test e-mail images (Firebase/GCS legacy → site vitrine) — sans MongoDB / Nest.
 *
 * Usage :
 *   node scripts/test-email-media-images.mjs
 *   node scripts/test-email-media-images.mjs --dry-run
 *   node scripts/test-email-media-images.mjs --to=autre@email.com
 *
 * Prérequis : .env avec SMTP_USER + SMTP_APP_PASSWORD (docs/MAIL_SETUP.md).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_TO = 'borissandeu0@gmail.com';

const LEGACY_SAMPLES = [
  {
    label: 'Logo thème (platform-theme)',
    url: 'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/platform-theme%2Flogo.png?alt=media&token=legacy-test',
  },
  {
    label: 'Image catalogue (plat)',
    url: 'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/catalog%2Fmeal.jpg?alt=media',
  },
  {
    label: 'Hero onboarding (email-heroes)',
    url: 'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/email-heroes%2Fonboarding%2Fvendor%2Fsample.png?alt=media',
  },
];

function loadEnvFile(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    /* .env optionnel si vars déjà exportées */
  }
}

function parseArgs(argv) {
  let to = DEFAULT_TO;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    if (arg.startsWith('--to=')) {
      const v = arg.slice('--to='.length).trim();
      if (v) to = v;
    }
  }
  return { to, dryRun };
}

function extractObjectPath(url) {
  const firebaseMatch = url.match(/\/o\/([^?]+)/);
  if (firebaseMatch) {
    return decodeURIComponent(firebaseMatch[1].replace(/\+/g, ' '));
  }
  const gcsMatch = url.match(/storage\.googleapis\.com\/[^/]+\/(.+?)(?:\?|$)/);
  if (gcsMatch) {
    return decodeURIComponent(gcsMatch[1].replace(/\+/g, ' '));
  }
  const proxyMatch = url.match(/\/medias\/public\/([^?]+)/i);
  if (proxyMatch) {
    return decodeURIComponent(proxyMatch[1].replace(/\+/g, ' '));
  }
  return url;
}

function encodePath(path) {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

function resolveWebSiteBase(env) {
  return (
    env.EMAIL_WEBSITE_URL?.trim() ||
    env.PUBLIC_WEB_URL?.trim() ||
    'https://wise-eat.com'
  ).replace(/\/+$/, '');
}

function mapEmailPathToWeb(objectPath, base) {
  const norm = objectPath.replace(/^\/+/, '');
  if (!norm) return `${base}/images/email/fallback.png`;

  if (
    norm === 'platform-theme/logo.png' ||
    norm.startsWith('platform-theme/logo.')
  ) {
    return `${base}/logo.png`;
  }
  if (norm.startsWith('platform-theme/')) {
    const file = norm.split('/').pop() ?? '';
    return file
      ? `${base}/images/platform-theme/${file}`
      : `${base}/logo.png`;
  }
  if (norm.startsWith('email-heroes/')) {
    if (norm.includes('/vendor/') || norm.includes('vendor-onboarding')) {
      return `${base}/images/email-heroes/vendor-onboarding-01.png`;
    }
    if (norm.includes('/delivery/') || norm.includes('delivery-onboarding')) {
      return `${base}/images/email-heroes/delivery-onboarding-01.png`;
    }
    const file = norm.split('/').pop() ?? '';
    if (file.endsWith('.png') || file.endsWith('.jpg')) {
      return `${base}/images/email-heroes/${file}`;
    }
    return `${base}/images/email-heroes/vendor-onboarding-01.png`;
  }
  if (norm.startsWith('catalog/')) {
    const file = norm.split('/').pop() ?? '';
    if (file === 'meal.jpg') {
      return `${base}/images/email/catalog/meal.jpg`;
    }
    return `${base}/images/email/catalog/product-placeholder.jpg`;
  }
  if (norm.startsWith('drinks/') || norm.includes('/drinks/')) {
    return `${base}/images/email/drinks/drink-placeholder.jpg`;
  }
  if (norm.startsWith('stores/') || norm.includes('/stores/')) {
    return `${base}/images/email/stores/store-placeholder.png`;
  }
  if (norm.startsWith('ads/') || norm.includes('/ads/')) {
    return `${base}/images/email/ads/ad-placeholder.png`;
  }
  return `${base}/images/email/fallback.png`;
}

function resolveMediaUrl(url, env) {
  const raw = url.trim();
  const base = resolveWebSiteBase(env);

  if (
    raw.startsWith(`${base}/images/`) ||
    raw === `${base}/logo.png` ||
    (!raw.includes('firebasestorage.googleapis.com') &&
      !raw.includes('storage.googleapis.com') &&
      !raw.includes('/medias/public/'))
  ) {
    return raw;
  }

  const objectPath = extractObjectPath(raw);
  return mapEmailPathToWeb(objectPath, base);
}

function resolutionStatus(legacy, resolved, base) {
  if (resolved === legacy) return 'inchangé';
  if (resolved.includes('storage.googleapis.com')) return '⚠ GCS (cassé)';
  if (resolved.startsWith(base)) return '→ WEB ✓';
  return 'réécrit';
}

function needsResolve(url) {
  return (
    url.includes('firebasestorage.googleapis.com') ||
    url.includes('storage.googleapis.com') ||
    url.includes('/medias/public/')
  );
}

async function resolveHtmlImages(html, env) {
  const cache = new Map();
  return html.replace(
    /<img\b[^>]*\bsrc=(["'])([^"']+)\1/gi,
    (full, quote, src) => {
      const decoded = src.replace(/&quot;/gi, '"').replace(/&amp;/gi, '&');
      if (!needsResolve(decoded)) return full;
      if (!cache.has(decoded)) {
        cache.set(decoded, resolveMediaUrl(decoded, env));
      }
      const resolved = cache.get(decoded);
      if (resolved === decoded) return full;
      const safe = quote === '"' ? resolved.replace(/"/g, '&quot;') : resolved;
      return full.replace(src, safe);
    },
  );
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sectionImage(url, alt) {
  const safeUrl = url.replace(/"/g, '&quot;');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
  <tr><td align="center"><img src="${safeUrl}" alt="${escapeHtml(alt)}" width="544" style="max-width:100%;height:auto;border-radius:12px;display:block;" /></td></tr>
</table>`;
}

function buildHtml(args) {
  const { appName, samples, staticUrl, heroUrl, sentAt } = args;
  const parts = [
    `<h2 style="color:#392800;">Test images e-mail — migration stockage</h2>`,
    `<p>Cet e-mail vérifie la réécriture Firebase → GCS pour <strong>${escapeHtml(appName)}</strong>.</p>`,
    `<h3 style="color:#392800;">1. URLs Firebase legacy</h3>`,
  ];

  for (const row of samples) {
    parts.push(
      `<p><strong>${escapeHtml(row.label)}</strong></p>`,
      sectionImage(row.url, row.label),
      `<p style="font-size:13px;color:#6b7280;">Résolu : ${escapeHtml(row.resolved)}</p>`,
    );
  }

  parts.push(
    `<hr style="border:none;border-top:1px solid #e8e0d4;margin:20px 0;" />`,
    `<h3 style="color:#392800;">2. Image statique wise-eat.com</h3>`,
    sectionImage(staticUrl, 'Section aide'),
    `<p style="font-size:13px;color:#6b7280;">${escapeHtml(staticUrl)}</p>`,
  );

  if (heroUrl) {
    parts.push(
      `<hr style="border:none;border-top:1px solid #e8e0d4;margin:20px 0;" />`,
      `<h3 style="color:#392800;">3. Bannière hero (onboarding)</h3>`,
      `<img src="${heroUrl.replace(/"/g, '&quot;')}" alt="Hero" width="600" style="max-width:100%;height:auto;display:block;" />`,
    );
  }

  parts.push(
    `<p style="font-size:13px;color:#6b7280;margin-top:20px;">Diagnostic — ${escapeHtml(sentAt)}</p>`,
  );

  return parts.join('\n');
}

function wrapEmail(bodyHtml, env) {
  const appName = env.APP_NAME?.trim() || 'Wise Eat';
  const website =
    env.EMAIL_WEBSITE_URL?.trim() ||
    env.PUBLIC_WEB_URL?.trim() ||
    'https://wise-eat.com';
  const logo =
    env.EMAIL_LOGO_URL?.trim() || `${website.replace(/\/+$/, '')}/logo.png`;
  const logoResolved = resolveMediaUrl(logo, env);
  const support = env.SUPPORT_EMAIL?.trim() || env.SMTP_FROM?.trim() || '';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><title>${escapeHtml(appName)} — test images</title></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">
<tr><td align="center" style="padding:28px 24px;background:linear-gradient(135deg,#392800,#aa6900);">
<img src="${logoResolved.replace(/"/g, '&quot;')}" alt="${escapeHtml(appName)}" width="88" style="display:block;margin:0 auto 14px;border-radius:10px;" />
<p style="margin:0;font-size:20px;font-weight:700;color:#fdf8f0;">${escapeHtml(appName)}</p>
</td></tr>
<tr><td style="padding:32px 28px;">${bodyHtml}</td></tr>
<tr><td style="padding:28px 24px;background:#392800;text-align:center;color:#fdf8f0;font-size:13px;">
<p style="margin:0 0 8px;">${escapeHtml(appName)}</p>
${support ? `<p style="margin:0;"><a href="mailto:${escapeHtml(support)}" style="color:#d4a017;">${escapeHtml(support)}</a></p>` : ''}
</td></tr>
</table></td></tr></table></body></html>`;
}

async function main() {
  loadEnvFile(join(ROOT, '.env'));
  const opts = parseArgs(process.argv.slice(2));
  const env = process.env;
  const sentAt = new Date().toISOString();
  const appName = env.APP_NAME?.trim() || 'Wise Eat';
  const website = resolveWebSiteBase(env);

  console.log('\n=== Test e-mail images (site vitrine) ===');
  console.log(`Destinataire : ${opts.to}`);
  console.log(`Mode         : ${opts.dryRun ? 'dry-run' : 'envoi SMTP'}`);
  console.log('');

  const samples = LEGACY_SAMPLES.map((s) => ({
    ...s,
    resolved: resolveMediaUrl(s.url, env),
  }));

  for (const row of samples) {
    console.log(`[${row.label}]`);
    console.log(`  legacy   : ${row.url}`);
    console.log(`  resolved : ${row.resolved}`);
    console.log(`  status   : ${resolutionStatus(row.url, row.resolved, website)}`);
    console.log('');
  }

  const staticUrl = `${website}/images/help/help-section-01.png`;
  const heroUrl = `${website}/images/email-heroes/vendor-onboarding-01.png`;

  let bodyHtml = buildHtml({ appName, samples, staticUrl, heroUrl, sentAt });
  bodyHtml = await resolveHtmlImages(bodyHtml, env);
  const html = wrapEmail(bodyHtml, env);

  console.log('--- URLs <img> finales ---');
  for (const m of html.matchAll(/<img\b[^>]*\bsrc=(["'])([^"']+)\1/gi)) {
    const src = m[2];
    const broken =
      src.includes('firebasestorage') || src.includes('storage.googleapis.com');
    console.log(`  ${broken ? '⚠ cassé  ' : '✓ web    '} ${src}`);
  }
  console.log('');

  if (opts.dryRun) {
    console.log('Dry-run terminé — aucun e-mail envoyé.');
    return;
  }

  const user = env.SMTP_USER?.trim() ?? '';
  const pass = (
    env.SMTP_APP_PASSWORD?.trim() ||
    env.SMTP_PASS?.trim() ||
    ''
  ).replace(/\s/g, '');
  if (!user || !pass) {
    console.error('Erreur : SMTP_USER et SMTP_APP_PASSWORD requis dans .env');
    process.exit(1);
  }

  const host = env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const port = parseInt(env.SMTP_PORT?.trim() || '587', 10) || 587;
  const from = env.SMTP_FROM?.trim() || user;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"${appName}" <${from}>`,
    to: opts.to,
    subject: `[TEST] Images e-mail — ${appName}`,
    html,
    text: [
      `Test images e-mail — ${appName}`,
      '',
      ...samples.map(
        (r) => `${r.label}\nlegacy: ${r.url}\nresolved: ${r.resolved}`,
      ),
      `Statique: ${staticUrl}`,
      `Hero: ${heroUrl}`,
      sentAt,
    ].join('\n'),
  });

  console.log(`✓ E-mail envoyé à ${opts.to}`);
  console.log(
    '  Vérifiez Gmail : logo header, 3 images legacy, image statique, bannière hero.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
