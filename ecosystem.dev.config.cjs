/**
 * PM2 — africa-meals-api (développement).
 * Variables depuis africa-meals-api/.env.develop
 */
const path = require('path');
const apiPm2Env = require('./scripts/pm2-env-files.cjs');

const useClusterDev = process.env.PM2_DEV_CLUSTER === '1';
const apiPort = String(
  process.env.PM2_API_DEV_PORT || process.env.PM2_API_PORT || '9001',
);
const wsPort = String(
  process.env.PM2_WS_DEV_PORT || process.env.PM2_WS_PORT || '8001',
);
const adminDevPort = String(process.env.PM2_ADMIN_DEV_PORT || '3001');
const webDevPort = String(process.env.PM2_WEB_DEV_PORT || '5002');

const apiPortEnv = {
  NODE_PORT: apiPort,
  PORT: apiPort,
  SERVER_URL: `http://localhost:${apiPort}`,
  AFRICA_MEALS_WS_INTERNAL_URL: `http://localhost:${wsPort}`,
  STATUS_PROBE_API_URL: `http://localhost:${apiPort}/api/health`,
  STATUS_PROBE_ADMIN_URL: `http://localhost:${adminDevPort}/api/health`,
  STATUS_PROBE_WEB_URL: `http://localhost:${webDevPort}/`,
  STATUS_PROBE_TIMEOUT_MS: '3000',
};

const sharedDevApp = {
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  watch: false,
  merge_logs: true,
  time: true,
  max_restarts: 30,
  min_uptime: '5s',
  exp_backoff_restart_delay: 300,
};

const apiDevEnv = {
  NODE_ENV: 'development',
  ...apiPm2Env.devEnvVars(),
  ...apiPortEnv,
};

const apiInstances = Math.max(
  1,
  Number(process.env.PM2_DEV_API_INSTANCES || process.env.PM2_DEV_INSTANCES || '1') ||
    1,
);

const watchApp = {
  ...sharedDevApp,
  name: 'we-api-dev',
  cwd: apiPm2Env.apiDir,
  script: 'npm',
  args: 'run start:dev:resilient',
  max_memory_restart: '2G',
  env: apiDevEnv,
};

const clusterApps = [
  {
    ...sharedDevApp,
    name: 'we-api-dev-build',
    cwd: path.join(apiPm2Env.apiDir, '..'),
    script: 'scripts/pm2-dev-build-watch.mjs',
    args: 'africa-meals-api we-api-dev',
    interpreter: 'node',
    max_memory_restart: '1G',
  },
  {
    ...sharedDevApp,
    name: 'we-api-dev',
    cwd: apiPm2Env.apiDir,
    script: 'scripts/pm2-start.cjs',
    interpreter: 'node',
    instances: apiInstances,
    exec_mode: apiInstances > 1 ? 'cluster' : 'fork',
    listen_timeout: 30_000,
    kill_timeout: 15_000,
    reload_delay: 1_000,
    max_memory_restart: '2G',
    env: apiDevEnv,
  },
];

module.exports = {
  apps: useClusterDev ? clusterApps : [watchApp],
};
