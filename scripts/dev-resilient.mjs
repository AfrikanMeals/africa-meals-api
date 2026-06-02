#!/usr/bin/env node
/**
 * Relance `npm run <script>` après arrêt (crash Redis ETIMEDOUT, etc.).
 * Usage: node scripts/dev-resilient.mjs [npm-script] [--delay-ms=3000]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
let delayMs = 3000;
let npmScript = 'start:dev';

for (const arg of args) {
  if (arg.startsWith('--delay-ms=')) {
    delayMs = Math.max(500, parseInt(arg.slice('--delay-ms='.length), 10) || 3000);
  } else if (!arg.startsWith('--')) {
    npmScript = arg;
  }
}

let child = null;
let stopping = false;

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[dev-resilient ${ts}] ${msg}`);
}

function start() {
  log(`Starting: npm run ${npmScript}`);
  child = spawn('npm', ['run', npmScript], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) {
      process.exit(code ?? 0);
      return;
    }
    log(
      `Stopped (code=${code ?? 'null'}, signal=${signal ?? 'null'}). Restart in ${delayMs}ms…`,
    );
    setTimeout(start, delayMs);
  });
}

function shutdown() {
  stopping = true;
  if (child) {
    child.kill('SIGTERM');
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
