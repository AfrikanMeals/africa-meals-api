/**
 * Prépare africa-meals-api pour Firebase Cloud Functions :
 * - vend @africa-meals/* dans ./packages/ (chemins file: locaux pour yarn/npm en Cloud Build)
 * - copie .env.functions → .env.<projectId> (projet Firebase, sans utiliser .env k8s)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONOREPO_PACKAGES = [
  'africa-meals-proto',
  'africa-meals-field-selection',
];

const COPY_SKIP_DIRS = new Set(['node_modules', '.git', 'dist-test']);

function copyMonorepoPackage(srcDir, destDir) {
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (src) => !COPY_SKIP_DIRS.has(path.basename(src)),
  });
}

function ensureVendoredPackageBuilt(packageDir) {
  const distIndex = path.join(packageDir, 'dist', 'index.js');
  if (existsSync(distIndex)) {
    return;
  }
  execSync('npm install --legacy-peer-deps --no-audit --no-fund', {
    cwd: packageDir,
    stdio: 'inherit',
  });
  execSync('npm run build', { cwd: packageDir, stdio: 'inherit' });
}

const NPM_PACKAGE_PATHS = {
  '@africa-meals/proto': 'file:packages/africa-meals-proto',
  '@africa-meals/field-selection': 'file:packages/africa-meals-field-selection',
};

export function resolveMonorepoPackagesDir(apiRoot) {
  const candidates = [
    path.join(apiRoot, '../africa-meals-project/packages'),
    path.join(apiRoot, '../packages'),
    path.join(apiRoot, '../../africa-meals-project/packages'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'africa-meals-proto', 'package.json'))) {
      return dir;
    }
  }
  throw new Error(
    'Packages monorepo introuvables (africa-meals-proto). ' +
      'Vérifiez africa-meals-project/packages à côté de africa-meals-api.',
  );
}

export function readDefaultFirebaseProjectId(apiRoot) {
  try {
    const rc = JSON.parse(
      readFileSync(path.join(apiRoot, '.firebaserc'), 'utf8'),
    );
    const id = rc.projects?.default;
    if (typeof id === 'string' && id.trim()) return id.trim();
  } catch {
    /* ignore */
  }
  return 'wise-eat-com';
}

export function firebaseEnvProjectPath(apiRoot) {
  const projectId = readDefaultFirebaseProjectId(apiRoot);
  return path.join(apiRoot, `.env.${projectId}`);
}

export function prepareFirebaseFunctionsDeploy(apiRoot = path.join(__dirname, '..')) {
  const envFunctions = path.join(apiRoot, '.env.functions');
  const envProject = firebaseEnvProjectPath(apiRoot);
  const pkgPath = path.join(apiRoot, 'package.json');
  const pkgBackupPath = path.join(apiRoot, '.firebase-package.json.bak');
  const packagesDir = path.join(apiRoot, 'packages');
  const srcPackages = resolveMonorepoPackagesDir(apiRoot);

  if (!existsSync(envFunctions)) {
    throw new Error(`Fichier requis manquant : ${envFunctions}`);
  }

  writeFileSync(pkgBackupPath, readFileSync(pkgPath, 'utf8'), 'utf8');

  rmSync(packagesDir, { recursive: true, force: true });
  mkdirSync(packagesDir, { recursive: true });
  for (const name of MONOREPO_PACKAGES) {
    const dest = path.join(packagesDir, name);
    copyMonorepoPackage(path.join(srcPackages, name), dest);
    ensureVendoredPackageBuilt(dest);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const [name, filePath] of Object.entries(NPM_PACKAGE_PATHS)) {
    if (pkg.dependencies?.[name]) {
      pkg.dependencies[name] = filePath;
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  cpSync(envFunctions, envProject);

  execSync('npm install --legacy-peer-deps --no-audit --no-fund', {
    cwd: apiRoot,
    stdio: 'inherit',
  });

  return { apiRoot, pkgBackupPath, packagesDir, envProject };
}

export function cleanupFirebaseFunctionsDeploy(apiRoot = path.join(__dirname, '..')) {
  const pkgPath = path.join(apiRoot, 'package.json');
  const pkgBackupPath = path.join(apiRoot, '.firebase-package.json.bak');
  const packagesDir = path.join(apiRoot, 'packages');
  const envProject = firebaseEnvProjectPath(apiRoot);

  if (existsSync(pkgBackupPath)) {
    writeFileSync(pkgPath, readFileSync(pkgBackupPath, 'utf8'), 'utf8');
    rmSync(pkgBackupPath, { force: true });
  }
  rmSync(packagesDir, { recursive: true, force: true });
  rmSync(envProject, { force: true });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { envProject } = prepareFirebaseFunctionsDeploy();
  console.log(`OK — packages/ + ${path.basename(envProject)} prêts pour Firebase Functions`);
}
