import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Param,
  Query,
  Body,
  Headers,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments.service';

type ProviderId = 'WEBPAY' | 'KHIPU' | 'MERCADOPAGO';

/** Both interpolated values reach an HTML attribute, so quotes must not escape it. */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Bridges provider-side HTTP (return URLs + webhooks) to the transactions
 * subgraph's internal mutations.
 *
 * Return URLs come from the buyer's browser:
 *   - Webpay POSTs `token_ws` (and `TBK_ORDEN_COMPRA`) as form-encoded.
 *   - Khipu / MercadoPago redirect with GET, provider-specific query string.
 * After confirming with the subgraph, we redirect the buyer to
 * `/<lang>/cart/confirmation?paymentId=…` on the web app.
 *
 * Webhooks come from the provider's IPN servers:
 *   - Always server-to-server, never user-facing.
 *   - We verify the provider's signature where possible, then forward.
 */
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly payments: PaymentsService) {}

  // ─── Return URLs ──────────────────────────────────────────────────────────

  /**
   * Webpay POSTs the buyer back here after the card form. Body is
   * form-encoded with `token_ws` (and `TBK_ORDEN_COMPRA` on cancel).
   */
  @Post('return/webpay')
  async webpayReturn(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, string>,
  ) {
    return this._handleReturn('WEBPAY', { ...req.query, ...body }, req, res);
  }

  /**
   * Khipu / MercadoPago redirect with GET. Query params carry the provider's
   * payment id. The webhook is still the authoritative event — this just
   * confirms the buyer arrived and lets us populate the confirmation page.
   */
  @Get('return/:provider')
  async externalReturn(
    @Param('provider') providerParam: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const provider = this._normalizeProvider(providerParam);
    if (!provider) return res.status(400).send('Unknown provider');
    return this._handleReturn(
      provider,
      req.query as Record<string, unknown>,
      req,
      res,
    );
  }

  /**
   * Webpay does NOT send async webhooks — the return URL POST IS the signal.
   * Khipu and MercadoPago both do. Each has its own auth scheme.
   */
  /**
   * The signature is verified in the transactions subgraph, not here: the HMAC
   * key is the seller's `secretKey`, and which seller this webhook belongs to
   * is only known once the payment has been looked up. This handler rejects
   * unsigned requests as a cheap first filter and forwards the raw bytes the
   * provider actually signed.
   */
  @Post('webhook/khipu')
  async khipuWebhook(
    @Req() req: Request & { rawBody?: string },
    @Headers('x-khipu-signature') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (!signature) {
      this.logger.warn('Khipu webhook missing x-khipu-signature');
      return { ok: false };
    }
    const eventType =
      typeof body['event'] === 'string' ? body['event'] : 'notify';
    try {
      await this.payments.processWebhook(
        'KHIPU',
        eventType,
        body,
        req.rawBody,
        signature,
      );
    } catch (err) {
      // A rejected signature must not look like success to the caller, but it
      // also must not leak why it failed.
      this.logger.warn(`Khipu webhook rejected: ${String(err)}`);
      return { ok: false };
    }
    return { ok: true };
  }

  /**
   * MercadoPago's `x-signature` verification is not implemented, so the
   * subgraph refuses these webhooks outright rather than acting on unverified
   * events. The provider is not enabled for real sellers; implementing the
   * HMAC check is a prerequisite for switching it on (EK-1 / SEC-2).
   */
  @Post('webhook/mercadopago')
  async mercadoPagoWebhook(
    @Req() req: Request & { rawBody?: string },
    @Headers('x-signature') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    const eventType =
      (body['type'] as string) ??
      (req.query['topic'] as string) ??
      'notification';
    if (!body || Object.keys(body).length === 0) return { ok: false };
    try {
      await this.payments.processWebhook(
        'MERCADOPAGO',
        eventType,
        body,
        req.rawBody,
        signature,
      );
    } catch (err) {
      this.logger.warn(`MercadoPago webhook rejected: ${String(err)}`);
      return { ok: false };
    }
    return { ok: true };
  }

  // ─── Webpay hand-off page ─────────────────────────────────────────────────

  /**
   * Webpay only accepts the buyer via an HTTP form-POST carrying `token_ws`.
   * The web app builds that form in the DOM (`lib/webpay.ts`), but a native
   * client has no DOM: it can only open a URL. This endpoint is that URL — it
   * returns a page that immediately POSTs the token on for the buyer.
   *
   * `url` is restricted to Transbank hosts. Without that check this would be an
   * open relay that POSTs an attacker-chosen token to an attacker-chosen site
   * from inside our own origin.
   */
  @Get('webpay/redirect')
  webpayRedirect(
    @Query('url') url: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!url || !token || !this._isTransbankUrl(url)) {
      this.logger.warn(`Rejected Webpay redirect for host: ${url}`);
      return res.status(400).send('Invalid Webpay redirect');
    }

    return res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="es">
  <head><meta charset="utf-8" /><title>Redirigiendo a Webpay…</title></head>
  <body onload="document.forms[0].submit()">
    <p>Redirigiendo a Webpay…</p>
    <form method="POST" action="${escapeHtmlAttr(url)}">
      <input type="hidden" name="token_ws" value="${escapeHtmlAttr(token)}" />
      <noscript><button type="submit">Continuar</button></noscript>
    </form>
  </body>
</html>`);
  }

  private _isTransbankUrl(raw: string): boolean {
    try {
      const parsed = new URL(raw);
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'transbank.cl' ||
          parsed.hostname.endsWith('.transbank.cl'))
      );
    } catch {
      return false;
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async _handleReturn(
    provider: ProviderId,
    payload: Record<string, unknown>,
    req: Request,
    res: Response,
  ) {
    const lang = (req.cookies?.['NEXT_LOCALE'] as string) || 'es';
    try {
      const result = await this.payments.processReturn(provider, payload);
      const target = `${this._webAppBase(req)}/${lang}/cart/confirmation?paymentId=${result.paymentId}`;
      return res.redirect(303, target);
    } catch (err) {
      this.logger.error('Provider return handling failed', err);
      const target = `${this._webAppBase(req)}/${lang}/cart/confirmation`;
      return res.redirect(303, target);
    }
  }

  private _normalizeProvider(p: string): ProviderId | null {
    const u = p.toUpperCase();
    if (u === 'WEBPAY' || u === 'KHIPU' || u === 'MERCADOPAGO') return u;
    return null;
  }

  /**
   * The buyer started the flow on the web app and needs to come back to it
   * after the provider redirect.
   *
   * The Referer is a hint, not an instruction: it is attacker-influenced, so a
   * page that links a buyer into `/payments/return/:provider` could otherwise
   * choose the redirect target and receive them — plus the `paymentId` — on its
   * own origin. Only origins we actually serve the web app from are honoured;
   * anything else falls back to the configured base URL.
   */
  private _webAppBase(req: Request): string {
    const fallback = process.env.WEB_APP_BASE_URL ?? '';
    const referer = req.headers.referer;
    if (!referer) return fallback;

    let origin: string;
    try {
      origin = new URL(referer).origin;
    } catch {
      return fallback;
    }

    return this._allowedWebAppOrigins().includes(origin) ? origin : fallback;
  }

  /**
   * Origins the buyer may be returned to. `WEB_APP_BASE_URL` is always
   * included so the fallback is self-consistent; `WEB_APP_RETURN_ORIGINS` is an
   * optional comma-separated list for the other clients (admin, staging).
   */
  private _allowedWebAppOrigins(): string[] {
    const configured = [
      process.env.WEB_APP_BASE_URL,
      ...(process.env.WEB_APP_RETURN_ORIGINS ?? '').split(','),
    ];

    return configured
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .map((value) => {
        try {
          return new URL(value).origin;
        } catch {
          return '';
        }
      })
      .filter(Boolean);
  }
}
