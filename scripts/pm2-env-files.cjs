/**
 * Fichiers d'environnement PM2 pour africa-meals-api.
 * - dev  → .env.develop
 * - prod → .env
 */
const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, '..');
const prodEnvFile = '.env';
const devEnvFile = '.env.develop';
const prodEnvPath = path.join(apiDir, prodEnvFile);
const devEnvPath = path.join(apiDir, devEnvFile);

const localEnvPath = path.join(apiDir, '.env.local');

function loadEnvVars(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    const dotenv = require(path.join(apiDir, 'node_modules/dotenv'));
    return dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  } catch (err) {
    console.warn(
      `[pm2-env] Impossible de charger ${envPath}:`,
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}

/** Fusionne les fichiers env comme Nest ConfigModule (.env.local prioritaire). */
function mergeEnvVars(...paths) {
  const merged = {};
  for (const envPath of paths) {
    if (!fs.existsSync(envPath)) continue;
    Object.assign(merged, loadEnvVars(envPath));
  }
  return merged;
}

/** Prod PM2 : `.env` uniquement (pas `.env.local`). */
function prodEnvVars() {
  return loadEnvVars(prodEnvPath);
}

function devEnvVars() {
  return mergeEnvVars(devEnvPath, prodEnvPath, localEnvPath);
}

module.exports = {
  apiDir,
  prodEnvFile,
  devEnvFile,
  prodEnvPath,
  devEnvPath,
  prodEnvVars,
  devEnvVars,
};
