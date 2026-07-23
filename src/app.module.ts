import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloGatewayDriver, ApolloGatewayDriverConfig } from '@nestjs/apollo';
import {
  IntrospectAndCompose,
  RemoteGraphQLDataSource,
  GraphQLDataSourceProcessOptions,
} from '@apollo/gateway';
import { verify } from 'jsonwebtoken';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ImagesModule } from './images/images.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

interface GatewayContext {
  token?: string;
  sellerId?: string;
  adminId?: string;
  extensions?: {
    sellerId?: string;
    adminId?: string;
  };
}

// Custom DataSource to propagate auth headers to subgraphs
class AuthenticatedDataSource extends RemoteGraphQLDataSource {
  constructor(
    config: { url: string },
    private readonly jwtSecret: string,
    private readonly jwtRefreshSecret: string,
  ) {
    super(config);
  }

  willSendRequest(
    options: GraphQLDataSourceProcessOptions<Record<string, any>>,
  ) {
    const { request, context } = options;
    if (!request.http) return;

    const gatewayContext = context as GatewayContext;
    // Only forward token if it's valid
    if (gatewayContext?.token) {
      const isValid = this.validateToken(gatewayContext.token);
      if (isValid) {
        request.http.headers.set(
          'Authorization',
          `Bearer ${gatewayContext.token}`,
        );
      }
    }

    const sellerId =
      gatewayContext?.sellerId || gatewayContext?.extensions?.sellerId;
    if (sellerId) {
      request.http.headers.set('x-seller-id', sellerId);
    }

    const adminId =
      gatewayContext?.adminId || gatewayContext?.extensions?.adminId;
    if (adminId) {
      request.http.headers.set('x-admin-id', adminId);
    }

    // Forward the shared internal secret to the transactions subgraph so its
    // `processProviderReturn` / `processProviderWebhook` mutations can verify
    // that the call came from the gateway (not a public client). The
    // PaymentsService also sends this directly when calling the subgraph from
    // the REST controller; this header path covers any federated GraphQL
    // request that might also hit internal mutations later.
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    if (internalSecret) {
      request.http.headers.set('x-internal-secret', internalSecret);
    }
  }

  private validateToken(token: string): boolean {
    try {
      // Try access token secret first
      verify(token, this.jwtSecret);
      return true;
    } catch {
      try {
        // Try refresh token secret as fallback
        verify(token, this.jwtRefreshSecret);
        return true;
      } catch {
        return false;
      }
    }
  }
}

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
    // Rate limiting - 100 requests per minute per IP
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute in milliseconds
        limit: 100,
      },
    ]),
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
          // { name: 'notifications', url: getServiceUrl('NOTIFICATIONS') },
        ].filter((s) => s.url);

        const jwtSecret = configService.get<string>('JWT_SECRET') || '';
        const jwtRefreshSecret =
          configService.get<string>('JWT_REFRESH_SECRET') || '';

        return {
          gateway: {
            supergraphSdl: new IntrospectAndCompose({
              subgraphs,
            }),
            buildService({ url }: { name: string; url?: string }) {
              return new AuthenticatedDataSource(
                { url: url! },
                jwtSecret,
                jwtRefreshSecret,
              );
            },
          },
          server: {
            introspection: true,
            context: ({ req, res }: { req: any; res: any }) => {
              /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
              // Extract token from cookies or headers
              const accessToken: string =
                req.cookies?.token ||
                req.headers?.authorization?.split(' ')[1] ||
                '';
              const refreshToken: string = req.cookies?.refreshToken || '';

              let token = '';
              let decoded: {
                sellerId?: string;
                adminId?: string;
              } | null = null;

              if (accessToken) {
                try {
                  decoded = verify(accessToken, jwtSecret) as {
                    sellerId?: string;
                    adminId?: string;
                  };
                  token = accessToken;
                } catch {
                  // expired or invalid access token, fall through to refresh
                }
              }

              if (!decoded && refreshToken) {
                try {
                  decoded = verify(refreshToken, jwtRefreshSecret) as {
                    sellerId?: string;
                    adminId?: string;
                  };
                  token = refreshToken;
                } catch {
                  // refresh token also invalid
                }
              }

              const sellerId = decoded?.sellerId;
              const adminId = decoded?.adminId;

              return {
                req,
                res,
                token,
                sellerId,
                adminId,
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
