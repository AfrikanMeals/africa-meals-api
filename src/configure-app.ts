import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export type ConfigureAppOptions = {
  /** Ex. `api` en local ; `''` sur Cloud Functions si la fonction s’appelle `api` (URL …/api/…). */
  globalPrefix?: string;
};

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
    app.setGlobalPrefix(prefix);
  }

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
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
    .addTag('supported-countries', 'Pays supportés')
    .addTag('health', 'Santé de l’API')
    .addTag('notifications', 'Notifications push (FCM)')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      methodKey,
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
