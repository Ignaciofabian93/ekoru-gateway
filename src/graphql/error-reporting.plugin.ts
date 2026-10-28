import { randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import type { ApolloServerPlugin, BaseContext } from '@apollo/server';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import {
  type AccessTokenCheck,
  describeAccessToken,
} from '../auth/access-token';
import { I18nService } from '../common/i18n';

/**
 * Codes whose message was written for the person using the app. They reach
 * the app as they are; every other error reaches it as a generic message.
 */
const CLIENT_FACING = new Set([
  'UNAUTHORIZED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'BAD_REQUEST',
  'BAD_USER_INPUT',
  'USER_ERROR',
  'CONFLICT',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
]);

/** Extensions that describe the servers, not the request. They stay here. */
const SERVER_ONLY_EXTENSIONS = ['stacktrace', 'exception', 'serviceName'];

interface ReportingContext extends BaseContext {
  auth?: AccessTokenCheck;
  clientIp?: string;
  req?: { headers?: Record<string, string | string[] | undefined> };
}

/**
 * The app gets a short message; the log gets everything.
 *
 * Every error the gateway returns is logged on one line with the operation,
 * the field, the subgraph it came from, who was asking and, for a rejected
 * session, why (expired, missing, bad signature). Errors the app was not meant
 * to read (internal failures, unreachable subgraphs, raw driver messages)
 * reach it as a generic message carrying the same `ref` as the log line, so a
 * user's report leads straight to it.
 */
export function graphqlErrorReportingPlugin(): ApolloServerPlugin<ReportingContext> {
  const logger = new Logger('GraphQLErrors');
  const i18n = new I18nService();

  return {
    requestDidStart() {
      const ref = randomBytes(4).toString('hex');

      return Promise.resolve({
        didEncounterErrors(ctx) {
          const operation =
            ctx.operationName ??
            ctx.request.operationName ??
            'unnamed operation';
          const who = describeAccessToken(ctx.contextValue.auth);
          const ip = ctx.contextValue.clientIp ?? 'unknown ip';

          for (const error of ctx.errors) {
            const code = codeOf(error.extensions?.code);
            const field = error.path ? ` at ${error.path.join('.')}` : '';
            const service =
              typeof error.extensions?.serviceName === 'string'
                ? ` from ${error.extensions.serviceName}`
                : '';
            const line = `[ref ${ref}] ${code} in ${operation}${field}${service}: "${error.message}" | ${who} | ip ${ip}`;

            if (CLIENT_FACING.has(code)) {
              logger.warn(line);
              continue;
            }
            // Subgraph errors are logged with their cause by the subgraph; a
            // stack here only helps for failures inside the gateway itself.
            const cause = error.originalError;
            if (cause && !(cause instanceof GraphQLError) && cause.stack) {
              logger.error(line, cause.stack);
            } else {
              logger.error(line);
            }
          }
          return Promise.resolve();
        },

        willSendResponse(ctx) {
          const body = ctx.response.body;
          if (body?.kind !== 'single' || !body.singleResult.errors) {
            return Promise.resolve();
          }
          const language = i18n.parseAcceptLanguage(
            header(ctx.contextValue, 'accept-language'),
          );
          const generic = i18n.translate('errors.unexpected', language, {
            ref,
          });
          body.singleResult.errors = body.singleResult.errors.map((error) =>
            forClient(error, generic, ref),
          );
          return Promise.resolve();
        },
      });
    },
  };
}

function forClient(
  error: GraphQLFormattedError,
  generic: string,
  ref: string,
): GraphQLFormattedError {
  const code = codeOf(error.extensions?.code);
  if (!CLIENT_FACING.has(code)) {
    return {
      message: generic,
      locations: error.locations,
      path: error.path,
      extensions: { code, ref },
    };
  }
  const extensions = { ...error.extensions };
  for (const key of SERVER_ONLY_EXTENSIONS) delete extensions[key];
  return { ...error, extensions };
}

function codeOf(code: unknown): string {
  return typeof code === 'string' ? code : 'UNKNOWN';
}

function header(context: ReportingContext, name: string): string | undefined {
  const value = context.req?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}
