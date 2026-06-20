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

function loadEnvVars(envPath) {
  if (!fs.existsSync(envPath)) {
    console.warn(`[pm2-env] Fichier absent : ${envPath}`);
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

function prodEnvVars() {
  return loadEnvVars(prodEnvPath);
}

function devEnvVars() {
  return loadEnvVars(devEnvPath);
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
