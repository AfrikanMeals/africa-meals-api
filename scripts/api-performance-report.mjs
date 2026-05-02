#!/usr/bin/env node
/**
 * Évaluation des performances des routes REST et GraphQL — rapport Markdown + JSON.
 *
 * Usage:
 *   node scripts/api-performance-report.mjs https://api.example.com/api/
 *   node scripts/api-performance-report.mjs --base https://api.example.com/api/
 *   npm run bench:api -- https://localhost:3000/api/
 *
 * Variables d’environnement (équivalents CLI quand absent):
 *   API_BASE_URL | BASE_URL   URL de base (avec ou sans slash final)
 *   BENCH_ITERATIONS           Mesures par endpoint (défaut: 5)
 *   BENCH_WARMUP               0 = pas de warmup (défaut: 1 = 1er tir ignoré)
 *   BENCH_JWT | BENCH_TOKEN    Bearer JWT optionnel (routes protégées)
 *   BENCH_STORE_ID             Mongo ObjectId boutique pour storeMenu / store-menu-products
 *   BENCH_TIMEOUT_MS           Timeout client fetch ms (défaut: 120000)
 *
 * Limites (honnêtes dans le rapport MD):
 *   Métriques conteneur / CPU / mémoire process et temps base de données ne sont pas
 *   exposés par l’API sans instrumentation serveur (p.ex. Server-Timing, APM). Ce script
 *   documente tout ce qui est observable côté client HTTP + un parsing de GET /health.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @typedef {{ id: string, method: string, path: string, headers?: Record<string,string>, body?: string, skip?: boolean, skipReason?: string }} BenchCase */

function parseArgs(argv) {
  const out = {
    iterations: null,
    token: null,
    base: null,
    warmup: null,
    timeoutMs: null,
    storeId: null,
    help: false,
    positionals: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--iterations' || a === '-n') {
      out.iterations = Number(argv[++i]);
    } else if (a === '--token' || a === '-t') {
      out.token = argv[++i] || '';
    } else if (a === '--base' || a === '-b') {
      out.base = argv[++i] || '';
    } else if (a === '--timeout-ms') {
      out.timeoutMs = Number(argv[++i]);
    } else if (a === '--store-id' || a === '--store') {
      out.storeId = (argv[++i] || '').trim();
    } else if (a === '--no-warmup') {
      out.warmup = 0;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (!a.startsWith('-')) {
      out.positionals.push(a);
    }
  }
  return out;
}

function normalizeBase(raw) {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!u.endsWith('/')) u += '/';
  return u;
}

function resolveBaseUrl(args) {
  const fromPos = args.positionals.find(
    (p) => /^https?:\/\//i.test(p) || p.includes('localhost'),
  );
  // `--base` / `-b` prime sur l’argument positionnel.
  const raw =
    (args.base && args.base.trim()) ||
    fromPos ||
    process.env.API_BASE_URL ||
    process.env.BASE_URL ||
    'https://api.afrikan-meals.com';
  return normalizeBase(raw);
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

const INTERESTING_RES_HEADERS = [
  'content-type',
  'content-length',
  'server',
  'x-request-id',
  'x-cloud-trace-context',
  'server-timing',
  'cache-control',
  'etag',
];

function pickHeaders(res) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const k of INTERESTING_RES_HEADERS) {
    const v = res.headers.get(k);
    if (v) out[k] = v;
  }
  return out;
}

function summarizeJsonBody(text, maxLen = 4000) {
  const t = (text || '').trim();
  if (!t) return { kind: 'empty', preview: null, keys: null };
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      return {
        kind: 'json-object',
        keys: Object.keys(j).slice(0, 40),
        preview: t.length > maxLen ? `${t.slice(0, maxLen)}…` : t,
      };
    }
    if (Array.isArray(j)) {
      return {
        kind: 'json-array',
        keys: null,
        preview: `Array(length=${j.length})`,
      };
    }
    return { kind: 'json-other', keys: null, preview: t.slice(0, 500) };
  } catch {
    return { kind: 'non-json', keys: null, preview: t.slice(0, 400) };
  }
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

function storeMenuBody(storeId) {
  return JSON.stringify({
    query: `query StoreMenu($storeId: String!, $productsTake: Int, $productsPage: Int) {
      storeMenu(storeId: $storeId, productsTake: $productsTake, productsPage: $productsPage) {
        productsCount
        productsTotal
        store { id name }
        products { id title }
      }
    }`,
    variables: {
      storeId,
      productsTake: 24,
      productsPage: 1,
    },
  });
}

function favoritesListingBody() {
  return JSON.stringify({
    query: `query Fav($page: Int, $take: Int) {
      myFavoriteProductsListing(page: $page, take: $take) {
        items { id title }
        total
      }
    }`,
    variables: { page: 1, take: 10 },
  });
}

/**
 * @param {string} baseUrl
 * @param {string | null} authHeader
 * @param {{ storeId: string | null; includeStoreMenu: boolean }} opts
 * @returns {BenchCase[]}
 */
function buildCases(baseUrl, authHeader, opts) {
  const sid =
    opts.storeId?.trim() ||
    process.env.BENCH_STORE_ID?.trim() ||
    '000000000000000000000001';

  /** @type {BenchCase[]} */
  const cases = [
    {
      id: 'GET health',
      method: 'GET',
      path: 'health',
      category: 'system',
    },
    { id: 'GET product-categories', method: 'GET', path: 'product-categories', category: 'data' },
    { id: 'GET ads', method: 'GET', path: 'ads', category: 'data' },
    {
      id: 'GET supported-countries',
      method: 'GET',
      path: 'supported-countries',
      category: 'data',
    },
    {
      id: 'GET search (products)',
      method: 'GET',
      path:
        'search?searchContent=products&query=&page=1&take=20&sortBy=createdAt&sortDirection=desc&minPrice=0',
      category: 'data',
    },
    {
      id: 'GET search (stores)',
      method: 'GET',
      path:
        'search?searchContent=stores&query=&page=1&take=20&sortBy=createdAt&sortDirection=desc',
      category: 'data',
    },
    {
      id: `GET search/store-menu-products (storeId=${sid.slice(0, 8)}…)`,
      method: 'GET',
      path: `search/store-menu-products?storeId=${encodeURIComponent(sid)}&page=1&take=24`,
      category: 'data',
    },
    {
      id: 'POST graphql shopHome',
      method: 'POST',
      path: 'graphql',
      headers: { 'Content-Type': 'application/json' },
      body: SHOP_HOME_BODY,
      category: 'graphql',
    },
    {
      id: 'POST graphql productCategories',
      method: 'POST',
      path: 'graphql',
      headers: { 'Content-Type': 'application/json' },
      body: PRODUCT_CATEGORIES_BODY,
      category: 'graphql',
    },
    {
      id: `POST graphql storeMenu (storeId=${sid.slice(0, 8)}…)`,
      method: 'POST',
      path: 'graphql',
      headers: { 'Content-Type': 'application/json' },
      body: storeMenuBody(sid),
      category: 'graphql',
    },
  ];

  if (authHeader) {
    cases.push(
      {
        id: 'GET auth/me (JWT)',
        method: 'GET',
        path: 'auth/me',
        headers: { Authorization: authHeader },
        category: 'auth',
      },
      {
        id: 'GET announcements (JWT)',
        method: 'GET',
        path: 'announcements',
        headers: { Authorization: authHeader },
        category: 'data',
      },
      {
        id: 'POST graphql myFavoriteProductsListing (JWT)',
        method: 'POST',
        path: 'graphql',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: favoritesListingBody(),
        category: 'graphql',
      },
    );
  }

  return cases;
}

/**
 * @param {string} baseUrl
 * @param {BenchCase} c
 * @param {number} timeoutMs
 */
async function runOnce(baseUrl, c, timeoutMs) {
  const url = new URL(c.path, baseUrl);
  const headers = { Accept: 'application/json', ...(c.headers || {}) };
  const bodyBytes =
    c.body && c.method !== 'GET' ? Buffer.byteLength(c.body, 'utf8') : 0;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = performance.now();
  let status = 0;
  let bytes = 0;
  let ok = false;
  /** @type {Record<string, string>} */
  let resHeaders = {};
  let bodyText = '';
  let aborted = false;
  try {
    const res = await fetch(url, {
      method: c.method,
      headers,
      body: c.body && c.method !== 'GET' ? c.body : undefined,
      signal: controller.signal,
    });
    clearTimeout(tid);
    status = res.status;
    resHeaders = pickHeaders(res);
    bodyText = await res.text();
    bytes = Buffer.byteLength(bodyText, 'utf8');
    ok = res.ok;
  } catch (e) {
    clearTimeout(tid);
    aborted = e?.name === 'AbortError';
    return {
      ok: false,
      status: aborted ? 0 : 0,
      ms: performance.now() - t0,
      bytes: 0,
      error: aborted ? `client_timeout_${timeoutMs}ms` : String(e?.message || e),
      responseHeaders: {},
      requestSummary: {
        url: url.href,
        method: c.method,
        bodyBytes,
        clientTimeoutMs: timeoutMs,
      },
      bodyAnalysis: null,
    };
  }
  const bodyAnalysis = summarizeJsonBody(bodyText);
  let healthSlice = null;
  if (c.path === 'health' && bodyAnalysis.kind === 'json-object' && bodyText) {
    try {
      const h = JSON.parse(bodyText);
      healthSlice = {
        status: h.status,
        service: h.service,
        version: h.version,
        uptimeSeconds: h.uptimeSeconds,
        timestamp: h.timestamp,
      };
    } catch {
      healthSlice = null;
    }
  }
  return {
    ok,
    status,
    ms: performance.now() - t0,
    bytes,
    error: ok ? undefined : `HTTP ${status}`,
    responseHeaders: resHeaders,
    requestSummary: {
      url: url.href,
      method: c.method,
      bodyBytes,
      clientTimeoutMs: timeoutMs,
    },
    bodyAnalysis,
    healthSlice,
  };
}

async function benchCase(baseUrl, c, iterations, useWarmup, timeoutMs) {
  /** @type {{ ms: number, status: number, ok: boolean }[]} */
  const runs = [];
  const errors = [];
  let lastDetail = /** @type {Awaited<ReturnType<typeof runOnce>> | null} */ (null);
  const totalRuns = iterations + (useWarmup ? 1 : 0);
  for (let i = 0; i < totalRuns; i++) {
    const r = await runOnce(baseUrl, c, timeoutMs);
    lastDetail = r;
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
    category: c.category || 'other',
    status: last.status,
    success: okRuns.length > 0,
    successSamples: okRuns.length,
    totalSamples: runs.length,
    bytesSample: lastDetail?.bytes ?? 0,
    timingsMs,
    statsMs: st,
    statsSource: okRuns.length > 0 ? 'http_2xx_only' : 'all_runs_fallback',
    errors: errors.length ? [...new Set(errors)] : [],
    lastObservation: lastDetail,
  };
}

function clientEnvironment(timeoutMs, iterations, useWarmup) {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    node: process.version,
    pid: process.pid,
    cwd: process.cwd(),
    benchScript: fileURLToPath(import.meta.url),
    clientTimeoutMsDefault: timeoutMs,
    iterations,
    warmup: useWarmup,
  };
}

function mdReport({
  baseUrl,
  iterations,
  warmup,
  timeoutMs,
  storeIdNote,
  results,
  startedAt,
  durationMs,
  reportReliability,
  clientEnv,
}) {
  const warnBlock =
    reportReliability === 'all_requests_failed'
      ? `> **Attention : aucune requête HTTP 2xx.** Les statistiques de latence peuvent refléter des erreurs réseau, TLS, ou une BASE URL incorrecte.\n\n`
      : '';

  const rows = results
    .map(
      (r) =>
        `| ${r.category} | ${r.id} | ${r.method} | ${r.status || '—'} | ${r.success ? 'oui' : 'non'} | ${r.statsSource} | ${r.statsMs.n} | ${r.statsMs.min.toFixed(1)} | ${r.statsMs.avg.toFixed(1)} | ${r.statsMs.p95.toFixed(1)} | ${r.statsMs.max.toFixed(1)} | ${(r.bytesSample / 1024).toFixed(2)} |`,
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
      ? `## Classement par temps max (échantillons 2xx)\n\n${slowRows}\n\n`
      : '';

  const perRequestBlocks = results
    .map((r) => {
      const o = r.lastObservation;
      const h = o?.responseHeaders && Object.keys(o.responseHeaders).length
        ? Object.entries(o.responseHeaders)
            .map(([k, v]) => `  - \`${k}\`: ${v}`)
            .join('\n')
        : '  - *(aucun en-tête ciblé renvoyé ou requête en erreur)*';
      const req = o?.requestSummary;
      const reqLines = req
        ? `  - URL: \`${req.url}\`
  - Méthode: \`${req.method}\`
  - Corps requête (octets): **${req.bodyBytes}**
  - Timeout client \`fetch\` (AbortSignal): **${req.clientTimeoutMs} ms**`
        : '';
      let bodyLines = '';
      if (o?.healthSlice) {
        bodyLines = `### Données « process » (GET /health, extrait JSON)\n\n| Champ | Valeur |\n|-------|--------|\n| service | \`${o.healthSlice.service ?? ''}\` |\n| version | \`${o.healthSlice.version ?? ''}\` |\n| uptimeSeconds | ${o.healthSlice.uptimeSeconds ?? '—'} |\n| timestamp API | ${o.healthSlice.timestamp ?? '—'} |\n\n> Proxy léger d’état du **process Node** (pas CPU/RAM conteneur ni latence Mongo).\n`;
      } else if (o?.bodyAnalysis) {
        const ba = o.bodyAnalysis;
        bodyLines = `### Analyse du corps de réponse (dernier tir)\n\n- **Type:** \`${ba.kind}\`\n${ba.keys?.length ? `- **Clés racine (objet):** ${ba.keys.map((k) => `\`${k}\``).join(', ')}\n` : ''}`;
      }
      const gqlErrors =
        o?.bodyAnalysis?.preview &&
        String(o.bodyAnalysis.preview).includes('"errors"')
          ? '\n> Le JSON semble contenir des erreurs GraphQL — vérifier le corps dans le fichier `.json` exporté.\n'
          : '';

      return `### ${r.id}\n\n#### Métadonnées requête\n\n${reqLines}\n\n#### Métadonnées réponse (dernier tir)\n\n- **HTTP:** ${o?.status ?? r.status}\n- **Octets corps:** ${o?.bytes ?? r.bytesSample}\n- **En-têtes (sélection):**\n${h}\n\n#### Latence agrégée (ms)\n\n| N | min | moy | p50 | p95 | max | source |\n|---|---:|---:|---:|---:|---:|---|\n| ${r.statsMs.n} | ${r.statsMs.min.toFixed(1)} | ${r.statsMs.avg.toFixed(1)} | ${r.statsMs.p50.toFixed(1)} | ${r.statsMs.p95.toFixed(1)} | ${r.statsMs.max.toFixed(1)} | ${r.statsSource} |\n\n${r.errors.length ? `**Erreurs observées:** ${r.errors.join('; ')}\n\n` : ''}${bodyLines}${gqlErrors}---\n`;
    })
    .join('\n');

  return `# Rapport performance API & GraphQL

${warnBlock}## Paramètres du benchmark

| Paramètre | Valeur |
|-----------|--------|
| **BASE URL** | \`${baseUrl}\` |
| Itérations / endpoint | ${iterations} |
| Warmup (1er tir ignoré) | ${warmup ? 'oui' : 'non'} |
| Timeout client \`fetch\` | **${timeoutMs} ms** |
| Boutique \`storeId\` (menu) | ${storeIdNote} |
| Démarré | ${startedAt} |
| Durée totale bench | ${(durationMs / 1000).toFixed(2)} s |
| Fiabilité rapport | \`${reportReliability}\` |

## Environnement d’exécution du **client** benchmark

| Champ | Valeur |
|-------|--------|
| hostname | \`${clientEnv.hostname}\` |
| OS | ${clientEnv.platform} (${clientEnv.arch}) |
| noyau | \`${clientEnv.release}\` |
| Node.js | \`${clientEnv.node}\` |
| PID | ${clientEnv.pid} |
| cwd | \`${clientEnv.cwd}\` |
| script | \`${clientEnv.benchScript}\` |

## Conteneur, base de données et système **côté serveur**

Ce script **ne peut pas** mesurer depuis l’extérieur :

- CPU / mémoire du conteneur Cloud Run (ou autre) ;
- nombre de connexions MongoDB, temps de requêtes SQL/NoSQL, taille des documents ;
- files d’attente internes Nest.

**Recommandations** pour enrichir ces sections : activer **Cloud Trace** / **APM**, ajouter un middleware \`Server-Timing\` (ex. \`db;dur=12\`), ou exposer un endpoint interne de métriques (\`/metrics\`) réservé au réseau privé.

Les champs **uptime** et **version** issus de \`GET /health\` donnent un indicateur minimal sur le **process** API (voir la section détaillée de cette requête ci-dessous).

${slowSection}## Synthèse (latence ms, taille Ko)

| Catégorie | Endpoint | Méthode | HTTP dernier tir | 2xx ? | source stats | N | min | moy | p95 | max | taille (Ko) |
|-----------|----------|---------|------------------|-------|----------------|---|-----|-----|-----|-----|-------------|
${rows}

## Détail par requête (requête / réponse / timeouts / données observables)

${perRequestBlocks}

## Export machine

Un fichier \`.json\` est généré à côté de ce rapport avec les mêmes résultats + \`lastObservation\` bruts.
`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/api-performance-report.mjs [BASE_URL] [options]

BASE_URL (optionnel, 1er argument positionnel si commence par http):
  Exemple: https://api.example.com/api/

Options:
  --base, -b URL       même rôle que BASE_URL (priorité sur positionnel si les deux)
  --iterations, -n N   nombre de mesures par endpoint (défaut: env BENCH_ITERATIONS ou 5)
  --token, -t JWT      Authorization Bearer (env BENCH_JWT / BENCH_TOKEN)
  --store-id ID        Mongo ObjectId boutique (env BENCH_STORE_ID)
  --timeout-ms N       timeout client fetch (défaut: env BENCH_TIMEOUT_MS ou 120000)
  --no-warmup          inclure la première requête dans les stats
  -h, --help

Variables d'environnement: API_BASE_URL, BASE_URL, BENCH_*
`);
    process.exit(0);
  }

  const baseUrl = resolveBaseUrl(args);
  if (!/^https?:\/\//i.test(baseUrl)) {
    console.error(
      'Erreur: BASE URL doit être une URL absolue (https://...). Exemple:\n  node scripts/api-performance-report.mjs https://votre-api.com/api/',
    );
    process.exit(2);
  }

  const iterations = Number.isFinite(args.iterations)
    ? Math.max(1, Math.floor(args.iterations))
    : Math.max(1, Math.floor(Number(process.env.BENCH_ITERATIONS) || 5));
  const useWarmup =
    args.warmup === 0 ? false : Number(process.env.BENCH_WARMUP) !== 0;

  const timeoutMs = Number.isFinite(args.timeoutMs)
    ? Math.max(1000, Math.floor(args.timeoutMs))
    : Math.max(
        5000,
        Math.floor(Number(process.env.BENCH_TIMEOUT_MS) || 120000),
      );

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

  const storeId =
    (args.storeId || process.env.BENCH_STORE_ID || '').trim() ||
    '000000000000000000000001';
  const storeIdNote = `\`${storeId}\` *(défaut bidon si non fourni — menu souvent vide ou 404 GraphQL)*`;

  const cases = buildCases(baseUrl, authHeader, {
    storeId,
    includeStoreMenu: true,
  });

  const clientEnv = clientEnvironment(timeoutMs, iterations, useWarmup);

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const results = [];
  for (const c of cases) {
    if (c.skip) {
      continue;
    }
    process.stderr.write(`… ${c.id}\n`);
    results.push(await benchCase(baseUrl, c, iterations, useWarmup, timeoutMs));
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
      clientTimeoutMs: timeoutMs,
      storeId,
      startedAt,
      durationMs,
      hasAuth: Boolean(authHeader),
      reportReliability,
      anyHttp2xx: anySuccess,
      clientEnvironment: clientEnv,
      serverDeepMetricsNote:
        'Container/DB/system internals require server instrumentation (Server-Timing, APM, /metrics).',
    },
    results: results.map((r) => ({
      id: r.id,
      category: r.category,
      method: r.method,
      path: r.path,
      status: r.status,
      success: r.success,
      statsMs: r.statsMs,
      statsSource: r.statsSource,
      bytesSample: r.bytesSample,
      errors: r.errors,
      timingsMs: r.timingsMs,
      lastObservation: r.lastObservation,
    })),
  };

  await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  const md = mdReport({
    baseUrl,
    iterations,
    warmup: useWarmup,
    timeoutMs,
    storeIdNote,
    results,
    startedAt,
    durationMs,
    reportReliability,
    clientEnv,
  });
  await writeFile(mdPath, md, 'utf8');

  console.log('\n--- Résumé (moyenne ms) ---\n');
  for (const r of results) {
    const flag = r.status >= 200 && r.status < 300 ? '✓' : '✗';
    console.log(
      `${flag} ${r.id.padEnd(48)} avg=${r.statsMs.avg.toFixed(0).padStart(5)} ms  p95=${r.statsMs.p95.toFixed(0).padStart(5)} ms  HTTP ${r.status}`,
    );
  }
  console.log(`\nRapports écrits:\n  ${mdPath}\n  ${jsonPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
