import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

/** Aligné sur la demande produit : accès diagnostic protégé par HTTP Basic uniquement. */
const BASIC_USER = 'admin';
const BASIC_PASS = 'Afrikan@Meals.2026';

function verifyBasicAuth(authorization: string | undefined): boolean {
  if (!authorization?.startsWith('Basic ')) {
    return false;
  }
  try {
    const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString(
      'utf8',
    );
    const i = decoded.indexOf(':');
    if (i < 0) {
      return false;
    }
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);
    return user === BASIC_USER && pass === BASIC_PASS;
  } catch {
    return false;
  }
}

/**
 * Liste **toutes** les variables d’environnement du processus (valeurs en clair).
 * `GET /api/debug/env` — HTTP Basic : admin / Afrikan@Meals.2026
 */
@ApiExcludeController()
@Controller('debug/env')
export class EnvDebugController {
  @Get()
  allEnv(@Req() req: Request, @Res() res: Response): void {
    if (!verifyBasicAuth(req.headers.authorization)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Env (full dump)"');
      res.status(401).type('text/plain').send('Unauthorized');
      return;
    }
    const out: Record<string, string | undefined> = {};
    for (const key of Object.keys(process.env).sort()) {
      out[key] = process.env[key];
    }
    res
      .status(200)
      .setHeader('Cache-Control', 'no-store')
      .json(out);
  }
}
