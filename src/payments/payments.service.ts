import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

type ProviderId = 'WEBPAY' | 'KHIPU' | 'MERCADOPAGO';

/**
 * Result the gateway needs from the transactions subgraph to redirect the
 * buyer back to the web app's confirmation page.
 */
export interface ProcessReturnResult {
  paymentId: number;
  status: string;
}

/**
 * Thin client over the transactions subgraph for the gateway's
 * PaymentsController. We use GraphQL rather than a direct DB call so the
 * gateway never needs Postgres credentials of the transactions service.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Calls the transactions subgraph's `processProviderReturn` mutation. The
   * subgraph runs the provider's confirm step (e.g. Webpay `tx.commit`) and
   * persists the canonical PaymentStatus.
   */
  async processReturn(
    provider: ProviderId,
    payload: Record<string, unknown>,
  ): Promise<ProcessReturnResult> {
    const data = await this._callTransactions(
      `mutation ProcessReturn($provider: ChileanPaymentProvider!, $payload: JSON!, $secret: String!) {
        processProviderReturn(provider: $provider, payload: $payload, internalSecret: $secret)
      }`,
      { provider, payload, secret: this._internalSecret() },
    );
    return {
      paymentId: this._extractPaymentIdFromPayload(provider, payload) ?? 0,
      status: data['processProviderReturn'] as string,
    };
  }

  async processWebhook(
    provider: ProviderId,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const data = await this._callTransactions(
      `mutation ProcessWebhook($provider: ChileanPaymentProvider!, $eventType: String!, $payload: JSON!, $secret: String!) {
        processProviderWebhook(provider: $provider, eventType: $eventType, payload: $payload, internalSecret: $secret)
      }`,
      { provider, eventType, payload, secret: this._internalSecret() },
    );
    return data['processProviderWebhook'] as string;
  }

  /**
   * Verifies a Khipu webhook signature against the raw request body.
   * Khipu sends `x-khipu-signature` as a hex HMAC-SHA256 of the body using
   * the seller's `webhookSecret`. We don't know which seller a webhook is
   * for at this layer, so the transactions subgraph re-verifies after
   * looking the payment up — but we still call this here as a cheap reject
   * for obviously-bad requests.
   */
  verifyKhipuSignature(
    rawBody: string,
    header: string,
    secret: string,
  ): boolean {
    if (!header || !secret) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private _internalSecret(): string {
    const secret = this.config.get<string>('INTERNAL_SERVICE_SECRET');
    if (!secret) throw new Error('INTERNAL_SERVICE_SECRET no configurado');
    return secret;
  }

  private async _callTransactions(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = this._transactionsUrl();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header form of the internal secret — the transactions GraphQL
        // context will pick it up so we don't have to repeat it as a field.
        'x-internal-secret': this._internalSecret(),
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      this.logger.error(
        `Transactions subgraph ${res.status}: ${await res.text()}`,
      );
      throw new Error(`transactions ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: Record<string, unknown>;
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      this.logger.error('Transactions GraphQL errors', body.errors);
      throw new Error(body.errors[0].message);
    }
    return body.data ?? {};
  }

  private _transactionsUrl(): string {
    const env = this.config.get<string>('ENVIRONMENT', 'development');
    const prefix =
      env === 'development' ? 'DEV' : env === 'staging' ? 'STAGING' : 'PROD';
    const url = this.config.get<string>(`EKORU_TRANSACTIONS_${prefix}_URL`);
    if (!url)
      throw new Error(`EKORU_TRANSACTIONS_${prefix}_URL no configurado`);
    return url;
  }

  private _extractPaymentIdFromPayload(
    provider: ProviderId,
    payload: Record<string, unknown>,
  ): number | undefined {
    if (provider === 'WEBPAY') {
      const buyOrder = payload['TBK_ORDEN_COMPRA'] as string | undefined;
      if (!buyOrder) return undefined;
      // Format: ekoru-<orderId>-<base36>. Pull the orderId for the redirect
      // query string; the paymentId itself is returned by the subgraph.
      const match = /^ekoru-(\d+)-/.exec(buyOrder);
      return match ? parseInt(match[1], 10) : undefined;
    }
    return undefined;
  }
}
