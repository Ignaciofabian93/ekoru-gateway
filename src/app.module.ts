import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloGatewayDriver, ApolloGatewayDriverConfig } from '@nestjs/apollo';
import { IntrospectAndCompose } from '@apollo/gateway';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { checkAccessToken } from './auth/access-token';
import { APP_GUARD } from '@nestjs/core';
import depthLimit from 'graphql-depth-limit';
import {
  selectionCountLimit,
  MAX_DEPTH,
  MAX_SELECTIONS,
} from './graphql/validation-rules';
import { AuthModule } from './auth/auth.module';
import { ImagesModule } from './images/images.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { createThrottlerStorage } from './common/throttler/resilient-throttler.storage';
import {
  AuthenticatedDataSource,
  type GatewayContext,
} from './graphql/authenticated-data-source';
import { graphqlMetricsPlugin } from './graphql/error-metrics.plugin';
import { graphqlErrorReportingPlugin } from './graphql/error-reporting.plugin';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    // Metrics
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),

    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Rate limiting - 100 requests per minute per IP. Counted in Redis when
    // THROTTLER_REDIS_HOST is set, so restarts keep the counts (INF-11).
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: 60000, // 1 minute in milliseconds
            limit: 100,
          },
        ],
        storage: createThrottlerStorage({
          host: config.get<string>('THROTTLER_REDIS_HOST'),
          port: Number(config.get<string>('THROTTLER_REDIS_PORT') ?? 6379),
          password: config.get<string>('THROTTLER_REDIS_PASSWORD'),
          db: Number(config.get<string>('THROTTLER_REDIS_DB') ?? 1),
        }),
      }),
    }),
    GraphQLModule.forRootAsync<ApolloGatewayDriverConfig>({
      driver: ApolloGatewayDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const environment = configService.get<string>(
          'ENVIRONMENT',
          'development',
        );

        // Get subgraph URLs based on environment
        const getServiceUrl = (service: string) => {
          const envPrefix =
            environment === 'development'
              ? 'DEV'
              : environment === 'staging'
                ? 'STAGING'
                : 'PROD';
          return configService.get<string>(`EKORU_${service}_${envPrefix}_URL`);
        };

        const subgraphs = [
          { name: 'users', url: getServiceUrl('USERS') },
          { name: 'marketplace', url: getServiceUrl('MARKETPLACE') },
          { name: 'stores', url: getServiceUrl('STORES') },
          { name: 'services', url: getServiceUrl('SERVICES') },
          { name: 'blog-community', url: getServiceUrl('BLOG_COMMUNITY') },
          { name: 'search', url: getServiceUrl('SEARCH') },
          { name: 'transactions', url: getServiceUrl('TRANSACTIONS') },
        ].filter((s) => s.url);

        // Only the access-token secret is needed here. `JWT_REFRESH_SECRET`
        // is used exclusively by AuthService on the `/session/*` routes, which
        // is the only place a refresh token is now accepted.
        const jwtSecret = configService.getOrThrow<string>('JWT_SECRET');

        return {
          gateway: {
            supergraphSdl: new IntrospectAndCompose({
              subgraphs,
            }),
            buildService({ url }: { name: string; url?: string }) {
              return new AuthenticatedDataSource({ url: url! }, jwtSecret);
            },
          },
          server: {
            // Off in production: the supergraph schema lists every mutation,
            // including the internal ones, and there is no reason to hand that
            // map out publicly. Staging keeps it for tooling.
            introspection: environment !== 'production',
            // GraphQL requests and errors by code, for the alerts (INF-5),
            // and every error logged in full but sent to the app generic.
            plugins: [graphqlMetricsPlugin(), graphqlErrorReportingPlugin()],
            // Bounds the cost of a single request. See ./graphql/validation-rules.
            validationRules: [
              depthLimit(MAX_DEPTH),
              selectionCountLimit(MAX_SELECTIONS),
            ],
            context: ({ req, res }: { req: any; res: any }) => {
              /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
              // Only the short-lived access token authenticates a GraphQL
              // request. The refresh token is deliberately NOT accepted here.
              //
              // It used to be a fallback when the access token had expired,
              // which meant a 7-day credential authenticated every operation —
              // and because revocation is only checked in `/session/refresh`,
              // logging out or disabling an account left the token working
              // until it expired. Clients that get a 401 should call
              // `POST /session/refresh`, which rotates the pair and does check
              // revocation. Both web and mobile already do exactly that.
              const accessToken: string =
                req.cookies?.token ||
                req.headers?.authorization?.split(' ')[1] ||
                '';

              // Expired or invalid: the request continues unauthenticated and
              // resolvers reject it. The client refreshes and retries. `auth`
              // keeps the reason for the error log.
              const auth = checkAccessToken(
                accessToken,
                jwtSecret,
                Boolean(req.cookies?.refreshToken),
              );
              const decoded = auth.status === 'valid' ? auth.claims : null;

              return {
                req,
                res,
                token: decoded ? accessToken : '',
                sellerId: decoded?.sellerId,
                adminId: decoded?.adminId,
                adminRole: decoded?.adminRole,
                adminType: decoded?.adminType,
                adminSellerId: decoded?.adminSellerId ?? undefined,
                clientIp: req.ip,
                auth,
              } as GatewayContext & { req: any; res: any };
              /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
            },
          },
        };
      },
    }),
    AuthModule,
    ImagesModule,
    PaymentsModule,
    PrismaModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
