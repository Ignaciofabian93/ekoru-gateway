import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The request signals we can describe a sign-in with. */
export interface LoginAlertDetails {
  userAgent?: string;
  ipAddress?: string;
  occurredAt?: Date;
}

/**
 * Reports events to the users subgraph, which owns notification delivery.
 *
 * The gateway holds no templates and makes no delivery decisions: whether a
 * notification reaches a user — and through which channel — depends on
 * `SellerPreferences` and `NotificationTemplate`, neither of which is in the
 * gateway's Prisma schema. So the gateway reports *that a login happened* and
 * users decides the rest.
 *
 * Everything goes through the one `emitNotification` mutation. This class's
 * job is to keep call sites type-safe over that untyped `data` payload.
 *
 * Same transport as `PaymentsService`: a direct GraphQL call carrying
 * `x-internal-secret`, never through the federated router.
 */
@Injectable()
export class NotificationsClient {
  private readonly logger = new Logger(NotificationsClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Fire-and-forget: a security notice must never delay or fail a sign-in, so
   * this resolves even when the users subgraph is unreachable. Returns whether
   * the notification was recorded — false on any failure, and false when the
   * account is inactive or unknown.
   */
  async sendLoginAlert(
    sellerId: string,
    details: LoginAlertDetails,
  ): Promise<boolean> {
    return this.emit({
      sellerId,
      type: 'SECURITY_LOGIN_ALERT',
      actionUrl: '/account/security',
      data: {
        userAgent: details.userAgent ?? null,
        ipAddress: details.ipAddress ?? null,
        occurredAt: (details.occurredAt ?? new Date()).toISOString(),
      },
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async emit(input: {
    sellerId: string;
    type: string;
    relatedId?: string;
    actionUrl?: string;
    data: Record<string, unknown>;
  }): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation EmitNotification(
        $input: EmitNotificationInput!
        $secret: String!
      ) {
        emitNotification(input: $input, internalSecret: $secret)
      }
    `;

    try {
      const data = await this._callUsers(mutation, {
        input,
        secret: this._internalSecret(),
      });
      return data['emitNotification'] != null;
    } catch (error) {
      this.logger.error(
        `emitNotification(${input.type}) failed for seller ${input.sellerId}`,
        error,
      );
      return false;
    }
  }

  private _internalSecret(): string {
    const secret = this.config.get<string>('INTERNAL_SERVICE_SECRET');
    if (!secret) throw new Error('INTERNAL_SERVICE_SECRET no configurado');
    return secret;
  }

  private _usersUrl(): string {
    const env = this.config.get<string>('ENVIRONMENT', 'development');
    const prefix =
      env === 'development' ? 'DEV' : env === 'staging' ? 'STAGING' : 'PROD';
    const url = this.config.get<string>(`EKORU_USERS_${prefix}_URL`);
    if (!url) throw new Error(`EKORU_USERS_${prefix}_URL no configurado`);
    return url;
  }

  private async _callUsers(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(this._usersUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': this._internalSecret(),
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`users ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      data?: Record<string, unknown>;
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) throw new Error(body.errors[0].message);
    return body.data ?? {};
  }
}
