import { fieldSelectionMiddleware } from './common/field-selection/field-selection.middleware';
import { buildApiCorsOptions } from './common/cors/cors-options';
import { wiseEatCorsEarlyMiddleware } from './common/cors/wise-eat-cors.middleware';
import { CorsAwareHttpExceptionFilter } from './common/filters/cors-aware-http-exception.filter';
import { httpRequestLogMiddleware } from './common/logging/http-request-log.middleware';
import { isSwaggerEnabled } from './common/security/api-docs-exposure.util';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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
 * Configuration HTTP partagée : préfixe global, CORS, Swagger (désactivé en prod — M-02).
 */
export async function configureApplication(
  app: INestApplication,
  options?: ConfigureAppOptions,
): Promise<void> {
  app.use(wiseEatCorsEarlyMiddleware());
  app.enableCors(buildApiCorsOptions());

  app.useGlobalFilters(new CorsAwareHttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.use(httpRequestLogMiddleware());

  const prefix = options?.globalPrefix ?? 'api';
  if (prefix.length > 0) {
    app.use(legacyUnprefixedPathRewrite(prefix));
    app.setGlobalPrefix(prefix);
  } else {
    app.use(stripLeadingApiPathWhenNoNestPrefix());
  }

  /** Query `includeFields` / `excludeField(s)` → filtre JSON (intercepteur global). */
  app.use(fieldSelectionMiddleware());

  if (!isSwaggerEnabled()) {
    return;
  }

  const config = new DocumentBuilder()
    .setTitle('Wise Eat API')
    .setDescription("Documentation de l'API Wise Eat")
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addBasicAuth(
      { type: 'http', scheme: 'basic' },
      'google-merchant-basic',
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
    .addTag('documentation', 'Documentation & aide (CMS)')
    .addTag('supported-countries', 'Pays supportés')
    .addTag('health', 'Santé de l’API')
    .addTag('google-merchant', 'Flux produits Google Merchant Center')
    .addTag('platform-seo', 'SEO site vitrine (sitemaps catalogue)')
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
    customSiteTitle: 'Wise Eat API Docs',
  });
}
