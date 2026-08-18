import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { IncomingMessage } from 'http';

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

  // CORS configuration based on environment.
  //
  // Development uses `true` to reflect any origin back, which is fine locally.
  //
  // Staging previously listed `'*'` alongside the real origin, which — with
  // `credentials: true` — let any site on the internet make credentialed
  // cross-origin calls against an environment that shares its auth model with
  // production. Native clients are unaffected by removing it: CORS is a browser
  // mechanism, and React Native sends no Origin header to enforce against.
  const origin =
    environment === 'development'
      ? true
      : environment === 'staging'
        ? ['https://staging-app.ekoru.cl', 'https://staging-admin.ekoru.cl']
        : ['https://app.ekoru.cl', 'https://admin.ekoru.cl'];

  app.enableCors({
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  });

  // Cookie parser middleware
  app.use(cookieParser());

  // Increase payload limits.
  //
  // `verify` runs before the JSON is parsed and is the only place the exact
  // bytes are still available. Provider webhook signatures are HMACs over
  // those bytes, so re-serializing the parsed object would change key order and
  // whitespace and never match. Stashed on the request and forwarded to the
  // transactions subgraph, which owns the verification.
  app.useBodyParser('json', {
    limit: '20mb',
    verify: (
      req: IncomingMessage & { rawBody?: string },
      _res,
      buf: Buffer,
    ) => {
      if (buf?.length) req.rawBody = buf.toString('utf8');
    },
  });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });

  await app.listen(port);

  console.log(`Gateway running on port: ${port}`);
  console.log(`Environment: ${environment}`);
}
bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
