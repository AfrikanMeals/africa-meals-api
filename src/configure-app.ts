import { fieldSelectionMiddleware } from './common/field-selection/field-selection.middleware';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

export type ConfigureAppOptions = {
  /** Ex. `api` en local ; `''` sur Cloud Functions si la fonction s’appelle `api` (URL …/api/…). */
  globalPrefix?: string;
};

/**
 * Clients qui appellent sans le préfixe global `/${prefix}/…` (ex. `POST /auth/forgot-password`,
 * `DELETE /addresses/:id`) alors que Nest enregistre `POST /api/auth/…`, `DELETE /api/addresses/:id`.
 */
/**
 * Sur Cloud Functions, la fonction HTTP s’appelle souvent `api` (URL …/api/…)
 * et le préfixe Nest est **vide** pour éviter …/api/api/…. Certains proxies / émulateurs
 * laissent alors le chemin complet `/api/billing/…` au lieu de `/billing/…` — ce
 * middleware aligne sur les routes Nest (`/billing`, `/auth`, …).
 */
function stripLeadingApiPathWhenNoNestPrefix() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const raw = req.url ?? '';
    const q = raw.indexOf('?');
    const pathOriginal = q === -1 ? raw : raw.slice(0, q);
    const query = q === -1 ? '' : raw.slice(q);
    let pathOnly = pathOriginal;
    while (pathOnly === '/api' || pathOnly.startsWith('/api/')) {
      pathOnly =
        pathOnly === '/api' ? '/' : pathOnly.slice('/api'.length) || '/';
    }
    if (pathOnly !== pathOriginal) {
      req.url = pathOnly + query;
    }
    next();
  };
}

function legacyUnprefixedPathRewrite(globalPrefix: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const raw = req.url ?? '';
    const q = raw.indexOf('?');
    const pathOnly = q === -1 ? raw : raw.slice(0, q);
    const query = q === -1 ? '' : raw.slice(q);
    if (pathOnly.startsWith(`/${globalPrefix}/`)) {
      next();
      return;
    }
    const needsPrefix =
      pathOnly.startsWith('/auth/') ||
      pathOnly.startsWith('/users/') ||
      pathOnly === '/addresses' ||
      pathOnly.startsWith('/addresses/') ||
      pathOnly.startsWith('/addresses?');
    if (needsPrefix) {
      req.url = `/${globalPrefix}${pathOnly}${query}`;
    }
    next();
  };
}

/**
 * Configuration HTTP partagée : préfixe global, CORS, Swagger (sauf si DISABLE_SWAGGER=true).
 */
export async function configureApplication(
  app: INestApplication,
  options?: ConfigureAppOptions,
): Promise<void> {
  if (process.env.LOG_HTTP_BODIES === 'true') {
    app.use((req: any, _res, next) => {
      const ct = req.headers['content-type'];
      const isMultipart =
        typeof ct === 'string' && ct.includes('multipart/form-data');
      const body = isMultipart
        ? '(multipart)'
        : req.body
        ? JSON.stringify(req.body)
        : '(no body)';
      console.warn(`[REQ] ${req.method} ${req.originalUrl} body: ${body}`);
      next();
    });
  }

  const prefix = options?.globalPrefix ?? 'api';
  if (prefix.length > 0) {
    app.use(legacyUnprefixedPathRewrite(prefix));
    app.setGlobalPrefix(prefix);
  } else {
    app.use(stripLeadingApiPathWhenNoNestPrefix());
  }

  /** Query `includeFields` / `excludeField(s)` → filtre JSON (intercepteur global). */
  app.use(fieldSelectionMiddleware());

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      // Clients (admin / mobile) derrière ngrok : en-tête documenté par ngrok pour éviter l’interstitiel HTML.
      'ngrok-skip-browser-warning',
    ],
  });

  if (process.env.DISABLE_SWAGGER === 'true') {
    return;
  }

  const config = new DocumentBuilder()
    .setTitle('Africa Meals API')
    .setDescription("Documentation de l'API Africa Meals")
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addTag('auth', 'Authentification et inscription')
    .addTag('stores', 'Restaurants / magasins')
    .addTag('products', 'Produits et catégories')
    .addTag('cart', 'Panier')
    .addTag('orders', 'Commandes')
    .addTag('addresses', 'Adresses')
    .addTag('offers', 'Offres et promos')
    .addTag('announcements', 'Annonces')
    .addTag('ads', 'Bannières accueil & gestion (admin / vendeur)')
    .addTag('billing', 'Paiement')
    .addTag('coupons', 'Codes promo boutique (admin & vendeur)')
    .addTag('search', 'Recherche')
    .addTag('mailer', 'Envoi d’emails (test)')
    .addTag('contact', 'Formulaire de contact site vitrine')
    .addTag('policies', 'Politiques & CGU (CMS)')
    .addTag('supported-countries', 'Pays supportés')
    .addTag('health', 'Santé de l’API')
    .addTag('notifications', 'Notifications push (FCM)')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
  });
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      showRequestDuration: true,
      tryItOutEnabled: true,
    },
    customSiteTitle: 'Africa Meals API Docs',
  });
}
