import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
    // The secret travels as the `x-internal-secret` header (see
    // `_callTransactions`), never as a GraphQL argument — the argument form
    // used to be part of the public schema.
    const data = await this._callTransactions(
      `mutation ProcessReturn($provider: ChileanPaymentProvider!, $payload: JSON!) {
        processProviderReturn(provider: $provider, payload: $payload) {
          paymentId
          status
        }
      }`,
      { provider, payload },
    );
    // The subgraph returns the canonical Payment id (it looked the payment up
    // to commit it). Trust that over re-deriving it from the provider payload —
    // a normal Webpay success carries only `token_ws`, no buy order.
    const result = data['processProviderReturn'] as {
      paymentId?: string;
      status?: string;
    } | null;
    return {
      paymentId: result?.paymentId
        ? Number(result.paymentId)
        : (this._extractPaymentIdFromPayload(provider, payload) ?? 0),
      status: result?.status ?? 'PROCESSING',
    };
  }

  /**
   * `rawBody` and `signature` are forwarded verbatim: the transactions subgraph
   * verifies the HMAC once the payment lookup tells it which seller's secret
   * applies. This layer cannot verify — it does not know the seller yet.
   */
  async processWebhook(
    provider: ProviderId,
    eventType: string,
    payload: Record<string, unknown>,
    rawBody?: string,
    signature?: string,
  ): Promise<string> {
    const data = await this._callTransactions(
      `mutation ProcessWebhook($provider: ChileanPaymentProvider!, $eventType: String!, $payload: JSON!, $rawBody: String, $signature: String) {
        processProviderWebhook(provider: $provider, eventType: $eventType, payload: $payload, rawBody: $rawBody, signature: $signature)
      }`,
      {
        provider,
        eventType,
        payload,
        rawBody: rawBody ?? null,
        signature: signature ?? null,
      },
    );
    return data['processProviderWebhook'] as string;
  }

  // Signature verification deliberately does not live here. It needs the
  // seller's secret, which is only resolvable after the payment lookup in the
  // transactions subgraph — see `PaymentsService._verifyWebhookSignature`
  // there. A copy of the HMAC check used to sit at this layer, uncalled, while
  // both layers' comments claimed the other one ran it.

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
