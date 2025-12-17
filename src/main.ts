import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  const environment = configService.get<string>('ENVIRONMENT', 'development');
  const port = configService.get<number>('PORT', 4000);

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
