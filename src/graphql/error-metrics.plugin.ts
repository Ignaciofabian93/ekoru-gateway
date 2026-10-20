import type { ApolloServerPlugin } from '@apollo/server';
import { Counter, register } from 'prom-client';

const REQUESTS = 'ekoru_graphql_requests_total';
const ERRORS = 'ekoru_graphql_errors_total';

/**
 * Counts GraphQL requests and the errors they return, by error code (INF-5).
 * A GraphQL failure answers HTTP 200, so an HTTP 5xx rate would never see a
 * subgraph that is down; these counters do. The codes are a small fixed set
 * (BAD_REQUEST, UNAUTHENTICATED, INTERNAL_SERVER_ERROR,
 * DOWNSTREAM_SERVICE_ERROR…), so the label stays cheap.
 */
export function graphqlMetricsPlugin(): ApolloServerPlugin {
  // A second module instance (watch-mode reloads) would otherwise throw on the duplicate name.
  register.removeSingleMetric(REQUESTS);
  register.removeSingleMetric(ERRORS);
  const requests = new Counter({
    name: REQUESTS,
    help: 'GraphQL requests answered by the gateway, by outcome',
    labelNames: ['outcome'] as const,
  });
  const errors = new Counter({
    name: ERRORS,
    help: 'GraphQL errors returned by the gateway, by error code',
    labelNames: ['code'] as const,
  });

  return {
    requestDidStart() {
      return Promise.resolve({
        didEncounterErrors({ errors: list }) {
          for (const error of list) {
            const code = error.extensions?.code;
            errors.inc({ code: typeof code === 'string' ? code : 'UNKNOWN' });
          }
          return Promise.resolve();
        },
        willSendResponse({ errors: list }) {
          requests.inc({ outcome: list?.length ? 'error' : 'ok' });
          return Promise.resolve();
        },
      });
    },
  };
}
