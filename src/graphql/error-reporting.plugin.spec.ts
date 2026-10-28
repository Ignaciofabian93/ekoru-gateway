import { Logger } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { sign } from 'jsonwebtoken';
import { checkAccessToken, describeAccessToken } from '../auth/access-token';
import { graphqlErrorReportingPlugin } from './error-reporting.plugin';

const SECRET = 'test-secret';

/** Runs the plugin's hooks the way Apollo Server does, without a server. */
async function run(errors: GraphQLError[], context: Record<string, unknown>) {
  const plugin = graphqlErrorReportingPlugin();
  const hooks = (await plugin.requestDidStart!({} as never))!;
  await hooks.didEncounterErrors!({
    errors,
    operationName: 'UnreadNotificationCount',
    request: {},
    contextValue: context,
  } as never);
  const body = {
    kind: 'single' as const,
    singleResult: { errors: errors.map((e) => e.toJSON()) },
  };
  await hooks.willSendResponse!({
    response: { body },
    contextValue: context,
  } as never);
  return body.singleResult.errors;
}

describe('checkAccessToken', () => {
  it('names the seller and the expiry of an expired token', () => {
    const token = sign(
      { sellerId: 'seller-1', exp: Math.floor(Date.now() / 1000) - 11 },
      SECRET,
    );
    const check = checkAccessToken(token, SECRET, false);
    expect(check).toMatchObject({
      status: 'expired',
      subject: 'seller seller-1',
    });
    expect(describeAccessToken(check)).toMatch(
      /^access token of seller seller-1 expired at .+ \(1[12] s before this request\)$/,
    );
  });

  it('reports a token signed with another secret', () => {
    const token = sign({ sellerId: 'seller-1' }, 'other-secret');
    expect(describeAccessToken(checkAccessToken(token, SECRET, false))).toBe(
      'access token of seller seller-1 rejected: invalid signature',
    );
  });

  it('tells an expired access cookie from a visitor who never signed in', () => {
    expect(describeAccessToken(checkAccessToken('', SECRET, true))).toMatch(
      /access cookie expired/,
    );
    expect(describeAccessToken(checkAccessToken('', SECRET, false))).toMatch(
      /not signed in/,
    );
  });
});

describe('graphqlErrorReportingPlugin', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs why a session was refused and passes the message through', async () => {
    const refused = new GraphQLError('Debe iniciar sesión', {
      path: ['unreadNotificationCount'],
      extensions: { code: 'UNAUTHORIZED', serviceName: 'users' },
    });
    const sent = await run([refused], {
      auth: checkAccessToken('', SECRET, true),
      clientIp: '203.0.113.7',
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /UNAUTHORIZED in UnreadNotificationCount at unreadNotificationCount from users: "Debe iniciar sesión" \| no access token, but a refresh cookie.* \| ip 203\.0\.113\.7$/,
      ),
    );
    expect(sent).toEqual([
      expect.objectContaining({
        message: 'Debe iniciar sesión',
        extensions: { code: 'UNAUTHORIZED' },
      }),
    ]);
  });

  it('sends a generic message for an internal error and logs the original', async () => {
    const internal = new GraphQLError(
      'request to http://ekoru-users:4001/graphql failed, reason: connect ECONNREFUSED',
      { extensions: { code: 'INTERNAL_SERVER_ERROR', stacktrace: ['at …'] } },
    );
    const [sent] = await run([internal], {});

    const ref = (sent.extensions as { ref: string }).ref;
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(sent).toEqual({
      message: `Ocurrió un error inesperado. Intenta de nuevo en unos minutos. (ref ${ref})`,
      extensions: { code: 'INTERNAL_SERVER_ERROR', ref },
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(`[ref ${ref}] INTERNAL_SERVER_ERROR`),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('connect ECONNREFUSED'),
    );
  });
});
