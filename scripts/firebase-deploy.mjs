#!/usr/bin/env node
/**
 * Déploie Firebase en utilisant .env.functions (pas .env k8s).
 *
 * Usage :
 *   node scripts/firebase-deploy.mjs
 *   node scripts/firebase-deploy.mjs deploy --only functions
 *   npm run deploy:functions
 */
import { execSync } from 'child_process';
import { existsSync, renameSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  cleanupFirebaseFunctionsDeploy,
  prepareFirebaseFunctionsDeploy,
} from './firebase-functions-prepare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(__dirname, '..');

const args = process.argv.slice(2);
const firebaseArgs =
  args.length > 0 ? args : ['deploy', '--only', 'functions'];
if (firebaseArgs[0] === 'deploy' && !firebaseArgs.includes('--force')) {
  firebaseArgs.push('--force');
}

const envPath = path.join(apiRoot, '.env');
const envStashPath = path.join(apiRoot, '.env.k8s.stash');
let envStashed = false;

try {
  prepareFirebaseFunctionsDeploy(apiRoot);

  if (existsSync(envPath)) {
    renameSync(envPath, envStashPath);
    envStashed = true;
  }

  execSync('npm run build', { cwd: apiRoot, stdio: 'inherit' });
  execSync(`npx firebase ${firebaseArgs.map((a) => JSON.stringify(a)).join(' ')}`, {
    cwd: apiRoot,
    stdio: 'inherit',
    shell: true,
  });
} finally {
  cleanupFirebaseFunctionsDeploy(apiRoot);
  if (envStashed && existsSync(envStashPath)) {
    renameSync(envStashPath, envPath);
  }
}
