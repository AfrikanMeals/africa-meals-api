import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';

const ACME_PATH =
  /^\/(?:api\/)?\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/;

export function isAcmeChallengePath(url: string): boolean {
  const pathOnly = (url.split('?')[0] ?? url).trim();
  return ACME_PATH.test(pathOnly);
}

/**
 * Sert les fichiers HTTP-01 Certbot depuis CERTBOT_WEBROOT lorsque la validation
 * LE atteint l'API (proxy sans location dédiée, ou chemin préfixé /api/…).
 */
export function acmeChallengeMiddleware() {
  const webroot = String(
    process.env.CERTBOT_WEBROOT ?? '/var/www/certbot',
  ).trim();
  const challengeDir = path.join(webroot, '.well-known', 'acme-challenge');

  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.url ?? '';
    const pathOnly = raw.split('?')[0] ?? raw;
    const match = pathOnly.match(ACME_PATH);
    if (!match) {
      next();
      return;
    }

    const token = match[1];
    const filePath = path.join(challengeDir, token);
    try {
      const body = fs.readFileSync(filePath, 'utf8');
      res.type('text/plain').send(body.trim());
    } catch {
      next();
    }
  };
}
