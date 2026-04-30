#!/usr/bin/env node
/**
 * Benchmark des temps de réponse de l’API Africa Meals (REST + GraphQL).
 *
 * Usage:
 *   npm run bench:api
 *   API_BASE_URL=https://staging.example.com/api/ node scripts/api-performance-report.mjs
 *   node scripts/api-performance-report.mjs --iterations 10 --token "$JWT"
 *
 * Variables d’environnement:
 *   API_BASE_URL   Base avec slash final (défaut: https://api.afrikan-meals.com/api/)
 *   BENCH_ITERATIONS  nombre de mesures par endpoint (défaut: 5)
 *   BENCH_WARMUP     1 = ignorer la 1re mesure par endpoint (défaut: 1)
 *   BENCH_JWT        Bearer optionnel pour GET auth/me
 *   BENCH_TOKEN      alias de BENCH_JWT
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { iterations: null, token: null, base: null, warmup: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--iterations' || a === '-n') {
      out.iterations = Number(argv[++i]);
    } else if (a === '--token' || a === '-t') {
      out.token = argv[++i] || '';
    } else if (a === '--base' || a === '-b') {
      out.base = argv[++i] || '';
    } else if (a === '--no-warmup') {
      out.warmup = 0;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function normalizeBase(raw) {
  let u = (
    raw ||
    process.env.API_BASE_URL ||
    'https://api.afrikan-meals.com/api'
  ).trim();
  if (!u.endsWith('/')) u += '/';
  return u;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.round((p / 100) * (sorted.length - 1));
  return sorted[i];
}

function stats(msList) {
  const sorted = [...msList].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return { n: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    avg: sum / n,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

const SHOP_HOME_BODY = JSON.stringify({
  query: `query ShopHome($productsTake: Int) {
    shopHome(productsTake: $productsTake) {
      productsCount
      announcements
      ads
      categories
      products
    }
  }`,
  variables: { productsTake: 24 },
});

const PRODUCT_CATEGORIES_BODY = JSON.stringify({
  query: `query ProductCategories {
    productCategories { id title icon isEnabled productCount }
  }`,
});

/** @type {{ id: string, method: string, path: string, headers?: Record<string,string>, body?: string }[]} */
function buildCases(baseUrl, authHeader) {
  const cases = [
    { id: 'GET health', method: 'GET', path: 'health' },
    { id: 'GET product-categories', method: 'GET', path: 'product-categories' },
    { id: 'GET ads', method: 'GET', path: 'ads' },
    { id: 'GET supported-countries', method: 'GET', path: 'supported-countries' },
    {
      id: 'GET search (products)',
      method: 'GET',
      path:
        'search?searchContent=products&query=&page=1&take=20&sortBy=createdAt&sortDirection=desc&minPrice=0',
    },
    {
      id: 'GET search (stores)',
      method: 'GET',
      path:
        'search?searchContent=stores&query=&page=1&take=20&sortBy=createdAt&sortDirection=desc',
    },
    {
      id: 'POST graphql shopHome',
      method: 'POST',
      path: 'graphql',
      headers: { 'Content-Type': 'application/json' },
      body: SHOP_HOME_BODY,
    },
    {
      id: 'POST graphql productCategories',
      method: 'POST',
      path: 'graphql',
      headers: { 'Content-Type': 'application/json' },
      body: PRODUCT_CATEGORIES_BODY,
    },
  ];
  if (authHeader) {
    cases.push(
      {
        id: 'GET auth/me (JWT)',
        method: 'GET',
        path: 'auth/me',
        headers: { Authorization: authHeader },
      },
      {
        id: 'GET announcements (JWT)',
        method: 'GET',
        path: 'announcements',
        headers: { Authorization: authHeader },
      },
    );
  }
  return cases;
}

async function runOnce(baseUrl, c) {
  const url = new URL(c.path, baseUrl);
  const headers = { Accept: 'application/json', ...(c.headers || {}) };
  const t0 = performance.now();
  let status = 0;
  let bytes = 0;
  let ok = false;
  try {
    const res = await fetch(url, {
      method: c.method,
      headers,
      body: c.body && c.method !== 'GET' ? c.body : undefined,
    });
    status = res.status;
    const buf = await res.arrayBuffer();
    bytes = buf.byteLength;
    ok = res.ok;
  } catch (e) {
    return {
      ok: false,
      status: 0,
      ms: performance.now() - t0,
      bytes: 0,
      error: String(e?.message || e),
    };
  }
  return {
    ok,
    status,
    ms: performance.now() - t0,
    bytes,
    error: ok ? undefined : `HTTP ${status}`,
  };
}

async function benchCase(baseUrl, c, iterations, useWarmup) {
  /** @type {{ ms: number, status: number, ok: boolean }[]} */
  const runs = [];
  const errors = [];
  let lastBytes = 0;
  const totalRuns = iterations + (useWarmup ? 1 : 0);
  for (let i = 0; i < totalRuns; i++) {
    const r = await runOnce(baseUrl, c);
    lastBytes = r.bytes;
    if (useWarmup && i === 0) continue;
    runs.push({ ms: r.ms, status: r.status, ok: r.ok });
    if (!r.ok || r.status < 200 || r.status >= 400) {
      if (r.error) errors.push(r.error);
    }
  }
  const okRuns = runs.filter((x) => x.status >= 200 && x.status < 400);
  const timingSource = okRuns.length > 0 ? okRuns : runs;
  const timingsMs = timingSource.map((x) => x.ms);
  const st = stats(timingsMs);
  const last = runs.length ? runs[runs.length - 1] : { status: 0, ms: 0 };
  return {
    id: c.id,
    method: c.method,
    path: c.path,
    status: last.status,
    success: okRuns.length > 0,
    successSamples: okRuns.length,
    totalSamples: runs.length,
    bytesSample: lastBytes,
    timingsMs,
    statsMs: st,
    statsSource: okRuns.length > 0 ? 'http_2xx_only' : 'all_runs_fallback',
    errors: errors.length ? [...new Set(errors)] : [],
  };
}

function mdReport({
  baseUrl,
  iterations,
  warmup,
  results,
  startedAt,
  durationMs,
  reportReliability,
}) {
  const warnBlock =
    reportReliability === 'all_requests_failed'
      ? `> **Attention : aucune requête HTTP 2xx.** Les temps (min/moy/max) ne reflètent pas la latence serveur (connexion refusée, mauvaise \`API_BASE_URL\`, TLS, etc.). Corrigez l’URL et relancez \`npm run bench:api\`.\n\n`
      : '';

  const rows = results
    .map(
      (r) =>
        `| ${r.id} | ${r.method} | \`${r.path.slice(0, 60)}${r.path.length > 60 ? '…' : ''}\` | ${r.status} | ${r.success ? 'oui' : 'non'} | ${r.statsSource} | ${r.statsMs.n} | ${r.statsMs.min.toFixed(1)} | ${r.statsMs.avg.toFixed(1)} | ${r.statsMs.p95.toFixed(1)} | ${r.statsMs.max.toFixed(1)} | ${(r.bytesSample / 1024).toFixed(2)} |`,
    )
    .join('\n');

  const ranked = [...results]
    .filter((r) => r.success)
    .sort((a, b) => b.statsMs.max - a.statsMs.max);
  const slowRows = ranked
    .map(
      (r, i) =>
        `${i + 1}. **${r.id}** — max **${r.statsMs.max.toFixed(1)} ms** (moy ${r.statsMs.avg.toFixed(1)} ms, p95 ${r.statsMs.p95.toFixed(1)} ms)`,
    )
    .join('\n');

  const slowSection =
    ranked.length > 0
      ? `## Classement par temps max (échantillons 2xx uniquement)\n\n${slowRows}\n\n`
      : '';

  return `# Rapport performance API

${warnBlock}- **Base:** \`${baseUrl}\`
- **Fiabilité:** \`${reportReliability}\` (stats latence = tirages **HTTP 2xx** uniquement si au moins un 2xx, sinon repli sur tous les tirages)
- **Itérations / endpoint:** ${iterations}
- **Warmup:** ${warmup ? 'oui (1er tir ignoré)' : 'non'}
- **Démarré:** ${startedAt}
- **Durée totale:** ${(durationMs / 1000).toFixed(2)} s

${slowSection}## Synthèse (latence ms)

| Endpoint | Méthode | Chemin | HTTP | 2xx ? | source stats | N | min | moy | p95 | max | taille (Ko) |
|----------|---------|--------|------|-------|----------------|---|-----|-----|-----|-----|-------------|
${rows}

## Détail JSON

Voir le fichier \`.json\` généré à côté de ce rapport.
`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/api-performance-report.mjs [options]

Options:
  --base, -b URL     API_BASE_URL (slash final recommandé)
  --iterations, -n N  nombre de mesures (défaut: env BENCH_ITERATIONS ou 5)
  --token, -t JWT    Authorization Bearer (défaut: BENCH_JWT / BENCH_TOKEN)
  --no-warmup        inclure la première requête dans les stats
`);
    process.exit(0);
  }

  const baseUrl = normalizeBase(args.base || process.env.API_BASE_URL);
  const iterations = Number.isFinite(args.iterations)
    ? Math.max(1, Math.floor(args.iterations))
    : Math.max(1, Math.floor(Number(process.env.BENCH_ITERATIONS) || 5));
  const useWarmup =
    args.warmup === 0 ? false : Number(process.env.BENCH_WARMUP) !== 0;

  const token =
    args.token ||
    process.env.BENCH_JWT ||
    process.env.BENCH_TOKEN ||
    '';
  const authHeader = token.trim()
    ? token.startsWith('Bearer ')
      ? token.trim()
      : `Bearer ${token.trim()}`
    : null;

  const cases = buildCases(baseUrl, authHeader);
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const results = [];
  for (const c of cases) {
    process.stderr.write(`… ${c.id}\n`);
    results.push(await benchCase(baseUrl, c, iterations, useWarmup));
  }
  const durationMs = performance.now() - t0;

  const anySuccess = results.some((r) => r.success);
  const reportReliability = anySuccess ? 'ok' : 'all_requests_failed';

  const reportDir = join(__dirname, 'reports');
  await mkdir(reportDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-');
  const baseName = `api-bench-${stamp}`;
  const jsonPath = join(reportDir, `${baseName}.json`);
  const mdPath = join(reportDir, `${baseName}.md`);

  const payload = {
    meta: {
      baseUrl,
      iterations,
      warmup: useWarmup,
      startedAt,
      durationMs,
      hasAuth: Boolean(authHeader),
      reportReliability,
      anyHttp2xx: anySuccess,
    },
    results: results.map((r) => ({
      ...r,
      timingsMs: r.timingsMs,
    })),
  };

  await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  const md = mdReport({
    baseUrl,
    iterations,
    warmup: useWarmup,
    results,
    startedAt,
    durationMs,
    reportReliability,
  });
  await writeFile(mdPath, md, 'utf8');

  console.log('\n--- Résumé (moyenne ms) ---\n');
  for (const r of results) {
    const flag = r.status >= 200 && r.status < 300 ? '✓' : '✗';
    console.log(
      `${flag} ${r.id.padEnd(38)} avg=${r.statsMs.avg.toFixed(0).padStart(5)} ms  p95=${r.statsMs.p95.toFixed(0).padStart(5)} ms  HTTP ${r.status}`,
    );
  }
  console.log(`\nRapports écrits:\n  ${mdPath}\n  ${jsonPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
