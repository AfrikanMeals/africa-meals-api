/**
 * Prépare africa-meals-api pour Firebase Cloud Functions :
 * - vend @africa-meals/* dans ./packages/ (chemins file: locaux pour yarn/npm en Cloud Build)
 * - copie .env.functions → .env.wise-eat-ca (projet Firebase, sans utiliser .env k8s)
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

export function prepareFirebaseFunctionsDeploy(apiRoot = path.join(__dirname, '..')) {
  const envFunctions = path.join(apiRoot, '.env.functions');
  const envProject = path.join(apiRoot, '.env.wise-eat-ca');
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
  const envProject = path.join(apiRoot, '.env.wise-eat-ca');

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
  prepareFirebaseFunctionsDeploy();
  console.log('OK — packages/ + .env.wise-eat-ca prêts pour Firebase Functions');
}
