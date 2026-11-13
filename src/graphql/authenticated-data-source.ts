import { AsyncLocalStorage } from 'node:async_hooks';
import {
  RemoteGraphQLDataSource,
  GraphQLDataSourceProcessOptions,
} from '@apollo/gateway';
import { OperationTypeNode } from 'graphql';
import { verify } from 'jsonwebtoken';
import type { AccessTokenCheck } from '../auth/access-token';

/**
 * How long a subgraph gets to answer (INF-24). Without a limit Node waits up
 * to 5 minutes, so one stuck subgraph held every request that touched it.
 *
 * Reads get 15 seconds. Writes get a minute, because the panel's spreadsheet
 * imports and the search reindex are single mutations that run for a while.
 * Loading the schema at boot isn't a visitor's request and gets the same
 * minute. SUBGRAPH_QUERY_TIMEOUT_MS and SUBGRAPH_MUTATION_TIMEOUT_MS change
 * them without a release.
 */
export interface SubgraphTimeouts {
  queryMs: number;
  mutationMs: number;
}

const fromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const subgraphTimeouts = (): SubgraphTimeouts => ({
  queryMs: fromEnv('SUBGRAPH_QUERY_TIMEOUT_MS', 15_000),
  mutationMs: fromEnv('SUBGRAPH_MUTATION_TIMEOUT_MS', 60_000),
});

/** The limit of the call in progress, read by the fetcher below. */
const deadline = new AsyncLocalStorage<number>();

export interface GatewayContext {
  token?: string;
  sellerId?: string;
  adminId?: string;
  adminRole?: string;
  adminType?: string;
  adminSellerId?: string;
  /** Visitor IP as seen through nginx; subgraphs rate-limit on it. */
  clientIp?: string;
  /** Why the request is, or is not, signed in. For the error log. */
  auth?: AccessTokenCheck;
  extensions?: {
    sellerId?: string;
    adminId?: string;
  };
}

// Custom DataSource to propagate auth headers to subgraphs
export class AuthenticatedDataSource extends RemoteGraphQLDataSource {
  constructor(
    config: { url: string },
    private readonly jwtSecret: string,
    private readonly timeouts: SubgraphTimeouts = subgraphTimeouts(),
  ) {
    super(config);

    // Same HTTP client as before, now with a limit: the call is aborted, not
    // just abandoned, so its socket is freed too.
    const send = this.fetcher;
    this.fetcher = (url, init) =>
      send(url, {
        ...init,
        signal: AbortSignal.timeout(
          deadline.getStore() ?? this.timeouts.mutationMs,
        ),
      });
  }

  process(options: GraphQLDataSourceProcessOptions<Record<string, any>>) {
    // Only a visitor's operation carries its request; loading the schema at
    // boot and health checks don't, and count as writes here.
    const isRead =
      'incomingRequestContext' in options &&
      options.incomingRequestContext.operation?.operation !==
        OperationTypeNode.MUTATION;
    return deadline.run(
      isRead ? this.timeouts.queryMs : this.timeouts.mutationMs,
      () => super.process(options),
    );
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

    // Subgraphs only ever see the gateway's address, so per-visitor rate
    // limits need the real client IP. Always overwrite: a client-supplied
    // value must never reach a subgraph.
    request.http.headers.set('x-client-ip', gatewayContext?.clientIp ?? '');

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
