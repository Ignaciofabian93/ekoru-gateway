import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  const environment = configService.get<string>('ENVIRONMENT', 'development');
  const port = configService.get<number>('PORT', 4000);

  // Security headers with Helmet
  app.use(
    helmet({
      contentSecurityPolicy:
        environment === 'production'
          ? {
              directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'https:'],
              },
            }
          : false, // Disable CSP in development for GraphQL playground
      crossOriginEmbedderPolicy: false, // Allow GraphQL playground to load
    }),
  );

  // CORS configuration based on environment
  const origin =
    environment === 'development'
      ? 'http://localhost:3000'
      : environment === 'qa'
        ? 'https://qa.app.ekoru.cl'
        : 'https://app.ekoru.cl';

  app.enableCors({
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  });

  // Cookie parser middleware
  app.use(cookieParser());

  // Increase payload limits
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });

  // Static file serving for images
  const imagesPath =
    environment === 'development'
      ? configService.get<string>('DEV_IMAGES_PATH', '/public/images')
      : configService.get<string>('IMAGES_PATH', '/app/images');

  app.useStaticAssets(imagesPath, { prefix: '/images' });

  await app.listen(port);

  console.log(`Gateway running on port: ${port}`);
  console.log(`Environment: ${environment}`);
}
bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
