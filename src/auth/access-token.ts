import { decode, verify, TokenExpiredError } from 'jsonwebtoken';

export interface AccessClaims {
  sellerId?: string;
  adminId?: string;
  adminRole?: string;
  adminType?: string;
  adminSellerId?: string | null;
  exp?: number;
}

/**
 * What the gateway found when it checked a request's access token.
 *
 * "Not signed in", "expired 11 s ago" and "bad signature" all reach the app as
 * the same UNAUTHORIZED, which is right for the app and useless for debugging.
 * The check is kept on the request so a rejection can be logged with its cause.
 */
export type AccessTokenCheck =
  | { status: 'valid'; claims: AccessClaims }
  | { status: 'missing'; hasRefreshCookie: boolean }
  | { status: 'expired'; expiredAt: Date; subject?: string }
  | { status: 'invalid'; reason: string; subject?: string };

export function checkAccessToken(
  token: string | undefined,
  secret: string,
  hasRefreshCookie: boolean,
): AccessTokenCheck {
  if (!token) return { status: 'missing', hasRefreshCookie };
  try {
    return { status: 'valid', claims: verify(token, secret) as AccessClaims };
  } catch (error) {
    // Read without verifying, for the log line only: it never authenticates.
    const subject = subjectOf(decode(token));
    if (error instanceof TokenExpiredError) {
      return { status: 'expired', expiredAt: error.expiredAt, subject };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 'invalid', reason, subject };
  }
}

export function describeAccessToken(
  check: AccessTokenCheck | undefined,
  now = new Date(),
): string {
  if (!check) return 'access token not checked';
  switch (check.status) {
    case 'valid': {
      const who = subjectOf(check.claims) ?? 'token without seller or admin id';
      const until = check.claims.exp
        ? `, valid until ${new Date(check.claims.exp * 1000).toISOString()}`
        : '';
      return `${who}${until}`;
    }
    case 'missing':
      return check.hasRefreshCookie
        ? 'no access token, but a refresh cookie: the access cookie expired and the app should refresh'
        : 'no access token and no refresh cookie: not signed in';
    case 'expired': {
      const ago = Math.round(
        (now.getTime() - check.expiredAt.getTime()) / 1000,
      );
      return `access token of ${check.subject ?? 'unknown subject'} expired at ${check.expiredAt.toISOString()} (${ago} s before this request)`;
    }
    case 'invalid':
      return `access token of ${check.subject ?? 'unknown subject'} rejected: ${check.reason}`;
  }
}

/** Who a token names, read without verifying it. For log lines only. */
export function tokenSubject(token: string): string {
  return subjectOf(decode(token)) ?? 'unknown subject';
}

function subjectOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const { sellerId, adminId } = payload as AccessClaims;
  if (sellerId) return `seller ${sellerId}`;
  if (adminId) return `admin ${adminId}`;
  return undefined;
}
