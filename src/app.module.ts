import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloGatewayDriver, ApolloGatewayDriverConfig } from '@nestjs/apollo';
import {
  IntrospectAndCompose,
  RemoteGraphQLDataSource,
  GraphQLDataSourceProcessOptions,
} from '@apollo/gateway';
import { AuthModule } from './auth/auth.module';
import { ImagesModule } from './images/images.module';
import { PrismaModule } from './prisma/prisma.module';

interface GatewayContext {
  token?: string;
  sellerId?: string;
  extensions?: {
    sellerId?: string;
  };
}

// Custom DataSource to propagate auth headers to subgraphs
class AuthenticatedDataSource extends RemoteGraphQLDataSource {
  willSendRequest(
    options: GraphQLDataSourceProcessOptions<Record<string, any>>,
  ) {
    const { request, context } = options;
    if (!request.http) return;

    const gatewayContext = context as GatewayContext;

    if (gatewayContext?.token) {
      request.http.headers.set(
        'Authorization',
        `Bearer ${gatewayContext.token}`,
      );
    }

    const sellerId =
      gatewayContext?.sellerId || gatewayContext?.extensions?.sellerId;
    if (sellerId) {
      request.http.headers.set('x-seller-id', sellerId);
    }
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
              : environment === 'qa'
                ? 'QA'
                : 'PROD';
          return configService.get<string>(
            `${service}_SERVICE_${envPrefix}_URL`,
          );
        };

        const subgraphs = [
          { name: 'users', url: getServiceUrl('USER') },
          // { name: 'products', url: getServiceUrl('PRODUCT') },
          // { name: 'services', url: getServiceUrl('SERVICES') },
          // { name: 'blog', url: getServiceUrl('BLOG') },
          // { name: 'search', url: getServiceUrl('SEARCH') },
          // { name: 'transaction', url: getServiceUrl('TRANSACTION') },
        ].filter((s) => s.url);

        return {
          gateway: {
            supergraphSdl: new IntrospectAndCompose({
              subgraphs,
            }),
            buildService({ url }) {
              return new AuthenticatedDataSource({ url });
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
              const token = cookieToken || headerToken || '';

              return {
                req,
                res,
                token,
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
})
export class AppModule {}
