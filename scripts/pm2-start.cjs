/**
 * Point d’entrée PM2 — enregistre tsconfig-paths puis charge le build Nest.
 * Attend dist/main.js (rebuild watch peut effacer dist/ brièvement).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const mainPath = path.join(__dirname, '../dist/main.js');
const maxWaitMs = Number(process.env.PM2_DIST_WAIT_MS || 60_000);

function pauseMs(ms) {
  if (process.platform === 'win32') {
    spawnSync('powershell', ['-Command', `Start-Sleep -Milliseconds ${ms}`], {
      stdio: 'ignore',
    });
    return;
  }
  spawnSync('sleep', [String(Math.max(0.05, ms / 1000))], { stdio: 'ignore' });
}

function waitForDistEntry() {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const stat = fs.statSync(mainPath);
      if (stat.isFile() && stat.size > 0) return;
    } catch {
      // dist/ en cours de rebuild
    }
    pauseMs(250);
  }
  throw new Error(
    `dist/main.js introuvable après ${maxWaitMs}ms — attendez la fin du build watch`,
  );
}

require('tsconfig-paths/register');
waitForDistEntry();
require(mainPath);
