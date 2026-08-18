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
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

interface GatewayContext {
  token?: string;
  sellerId?: string;
  adminId?: string;
  adminRole?: string;
  adminType?: string;
  adminSellerId?: string;
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
      // Authorization inputs, not just identity: subgraphs need the role to
      // decide *what* this admin may do, and the type/seller pair to keep a
      // BUSINESS admin inside their own data.
      if (gatewayContext.adminRole) {
        request.http.headers.set('x-admin-role', gatewayContext.adminRole);
      }
      if (gatewayContext.adminType) {
        request.http.headers.set('x-admin-type', gatewayContext.adminType);
      }
      if (gatewayContext.adminSellerId) {
        request.http.headers.set(
          'x-admin-seller-id',
          gatewayContext.adminSellerId,
        );
      }
    }

    // NOTE: `x-internal-secret` is deliberately NOT set here.
    //
    // It used to be attached to every federated request, which meant any
    // public caller — including an anonymous one — arrived at the subgraphs
    // already holding the credential that marks a request as internal. Since
    // the subgraph guards trust that header, every "internal only" mutation
    // (setProductAvailability, processProviderWebhook, awardPoints,
    // activateMembershipSubscription, …) was reachable straight through this
    // gateway without any authentication at all.
    //
    // Internal mutations are called service-to-service, never through
    // federation: the gateway's own PaymentsService, and the transactions
    // subgraph's MarketplaceClient / UsersClient, each set the header on their
    // direct HTTP call. Nothing legitimate needs it on this path.
  }

  /**
   * Access-token secret only. Accepting the refresh secret here would let a
   * refresh token be forwarded to the subgraphs as a bearer credential, which
   * is the same 7-day-session problem the context factory now avoids.
   */
  private validateToken(token: string): boolean {
    try {
      verify(token, this.jwtSecret);
      return true;
    } catch {
      return false;
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
        ].filter((s) => s.url);

        // Only the access-token secret is needed here. `JWT_REFRESH_SECRET`
        // is used exclusively by AuthService on the `/session/*` routes, which
        // is the only place a refresh token is now accepted.
        const jwtSecret = configService.get<string>('JWT_SECRET') || '';

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

              type AccessClaims = {
                sellerId?: string;
                adminId?: string;
                adminRole?: string;
                adminType?: string;
                adminSellerId?: string | null;
              };

              let token = '';
              let decoded: AccessClaims | null = null;

              if (accessToken) {
                try {
                  decoded = verify(accessToken, jwtSecret) as AccessClaims;
                  token = accessToken;
                } catch {
                  // Expired or invalid: the request continues unauthenticated
                  // and resolvers reject it. The client refreshes and retries.
                }
              }

              return {
                req,
                res,
                token,
                sellerId: decoded?.sellerId,
                adminId: decoded?.adminId,
                adminRole: decoded?.adminRole,
                adminType: decoded?.adminType,
                adminSellerId: decoded?.adminSellerId ?? undefined,
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
