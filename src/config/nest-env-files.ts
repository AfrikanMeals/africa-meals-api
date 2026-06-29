/** Fichiers env Nest — hors prod : `.env.develop` puis `.env.local`, puis `.env`. */
export function nestEnvFilePaths(): string[] {
  const nodeEnv = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  if (nodeEnv === 'production' || nodeEnv === 'prod') {
    return ['.env'];
  }
  return ['.env.develop', '.env.local', '.env', '../.env'];
}
