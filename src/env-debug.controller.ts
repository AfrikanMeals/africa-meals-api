import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  readEnvDebugBasicAuthCredentials,
  verifyEnvDebugBasicAuthHeader,
} from './env-debug.util';

/**
 * Liste les variables d’environnement du processus (valeurs en clair).
 * Enregistré uniquement si `ENABLE_ENV_DEBUG=true` et `NODE_ENV !== production`.
 */
@ApiExcludeController()
@Controller('debug/env')
export class EnvDebugController {
  @Get()
  allEnv(@Req() req: Request, @Res() res: Response): void {
    const credentials = readEnvDebugBasicAuthCredentials();
    if (!credentials) {
      res
        .status(503)
        .type('text/plain')
        .send('env_debug_not_configured');
      return;
    }

    if (
      !verifyEnvDebugBasicAuthHeader(
        req.headers.authorization,
        credentials.user,
        credentials.password,
      )
    ) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Env (diagnostic)"');
      res.status(401).type('text/plain').send('Unauthorized');
      return;
    }

    const out: Record<string, string | undefined> = {};
    for (const key of Object.keys(process.env).sort()) {
      out[key] = process.env[key];
    }
    res.status(200).setHeader('Cache-Control', 'no-store').json(out);
  }
}
