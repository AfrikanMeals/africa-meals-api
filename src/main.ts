import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use((req: any, _res, next) => {
    const body = req.body ? JSON.stringify(req.body) : '(no body)';
    console.warn(`[REQ] ${req.method} ${req.originalUrl} body: ${body}`);
    next();
  });

  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Africa Meals API')
    .setDescription('Documentation de l\'API Africa Meals')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addTag('auth', 'Authentification et inscription')
    .addTag('stores', 'Restaurants / magasins')
    .addTag('products', 'Produits et catégories')
    .addTag('cart', 'Panier')
    .addTag('orders', 'Commandes')
    .addTag('addresses', 'Adresses')
    .addTag('offers', 'Offres et promos')
    .addTag('announcements', 'Annonces')
    .addTag('billing', 'Paiement')
    .addTag('search', 'Recherche')
    .addTag('mailer', 'Envoi d’emails (test)')
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

  const port = Number(process.env.NODE_PORT || process.env.PORT || 3000);
  await app.listen(port);
  console.warn(`🚀 API: http://localhost:${port}/api (ex: /api/auth/verify, /api/auth/login)`);
}
bootstrap();
