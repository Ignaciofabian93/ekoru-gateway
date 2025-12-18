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
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';

interface GatewayContext {
  token?: string;
  sellerId?: string;
  extensions?: {
    sellerId?: string;
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
              : environment === 'qa'
                ? 'QA'
                : 'PROD';
          return configService.get<string>(
            `${service}_SERVICE_${envPrefix}_URL`,
          );
        };

        const subgraphs = [
          { name: 'users', url: getServiceUrl('USER') },
          { name: 'products', url: getServiceUrl('PRODUCT') },
          // { name: 'services', url: getServiceUrl('SERVICES') },
          { name: 'blog', url: getServiceUrl('BLOG') },
          // { name: 'search', url: getServiceUrl('SEARCH') },
          // { name: 'transaction', url: getServiceUrl('TRANSACTION') },
        ].filter((s) => s.url);

        const jwtSecret = configService.get<string>('JWT_SECRET') || '';
        const jwtRefreshSecret =
          configService.get<string>('JWT_REFRESH_SECRET') || '';

        return {
          gateway: {
            supergraphSdl: new IntrospectAndCompose({
              subgraphs,
            }),
            buildService({ url }: { name: string; url: string }) {
              return new AuthenticatedDataSource(
                { url },
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
              const cookieToken =
                req.cookies?.token || req.cookies?.refreshToken;
              const headerToken = req.headers?.authorization?.split(' ')[1];
              const token: string = cookieToken || headerToken || '';

              // Extract and verify sellerId from token
              let sellerId: string | undefined;
              if (token) {
                try {
                  const decoded = verify(token, jwtSecret) as {
                    sellerId: string;
                  };
                  sellerId = decoded.sellerId;
                } catch {
                  // Try refresh secret
                  try {
                    const decoded = verify(token, jwtRefreshSecret) as {
                      sellerId: string;
                    };
                    sellerId = decoded.sellerId;
                  } catch {
                    // Invalid token - sellerId remains undefined
                  }
                }
              }

              return {
                req,
                res,
                token,
                sellerId,
              } as GatewayContext & { req: any; res: any };
              /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
            },
          },
        };
      },
    }),
    AuthModule,
    ImagesModule,
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
