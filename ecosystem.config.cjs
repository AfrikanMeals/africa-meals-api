/**
 * PM2 — africa-meals-api (production).
 * Variables depuis africa-meals-api/.env
 */
const os = require('os');
const apiPm2Env = require('./scripts/pm2-env-files.cjs');

const cpuCount = Math.max(1, os.cpus().length);

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function resolveApiInstances() {
  const raw = process.env.PM2_API_INSTANCES;
  if (raw === 'max') return cpuCount;
  const explicit = toPositiveInt(raw);
  if (explicit) return Math.min(explicit, cpuCount);
  const cap = toPositiveInt(process.env.PM2_API_MAX) || 4;
  return Math.max(1, Math.min(cpuCount, cap));
}

const apiPort = String(
  process.env.PM2_API_PROD_PORT || process.env.PM2_API_PORT || '9000',
);
const wsPort = String(
  process.env.PM2_WS_PROD_PORT || process.env.PM2_WS_PORT || '8000',
);
const apiInstances = resolveApiInstances();

module.exports = {
  apps: [
    {
      name: 'africa-meals-api',
      cwd: apiPm2Env.apiDir,
      script: 'scripts/pm2-start.cjs',
      interpreter: 'node',
      instances: apiInstances,
      exec_mode: apiInstances > 1 ? 'cluster' : 'fork',
      autorestart: true,
      watch: false,
      merge_logs: true,
      time: true,
      listen_timeout: 15_000,
      kill_timeout: 8_000,
      max_restarts: 15,
      min_uptime: '10s',
      exp_backoff_restart_delay: 200,
      max_memory_restart: '1500M',
      env: {
        ...apiPm2Env.prodEnvVars(),
        NODE_PORT: apiPort,
        PORT: apiPort,
        SERVER_URL: `http://localhost:${apiPort}`,
        AFRICA_MEALS_WS_INTERNAL_URL: `http://localhost:${wsPort}`,
        NODE_ENV: 'production',
      },
    },
  ],
};
