# Checkout / Payments routes (2026-05-26)

The gateway is now the public HTTP edge for provider returns and webhooks.
See the cross-repo reference at
[`ekoru-web-app/docs/CHECKOUT.md`](../../ekoru-web-app/docs/CHECKOUT.md) §3
for the end-to-end picture.

## What changed here

- **Federation** ([`src/app.module.ts`](../src/app.module.ts)): the
  `transactions` subgraph is now wired into `IntrospectAndCompose`. Needs
  `EKORU_TRANSACTIONS_{DEV,STAGING,PROD}_URL` in env.
- **Internal-secret propagation**: `AuthenticatedDataSource.willSendRequest`
  now sets `x-internal-secret` on every outbound subgraph request so the
  transactions service can authenticate the gateway.
- **PaymentsController** ([`src/payments/payments.controller.ts`](../src/payments/payments.controller.ts))
  with the routes the providers redirect/webhook to:
  - `POST /payments/return/webpay` — Transbank form-POST.
  - `GET  /payments/return/khipu` — Khipu return.
  - `GET  /payments/return/mercadopago` — MercadoPago return.
  - `POST /payments/webhook/khipu` — Khipu IPN (verifies `x-khipu-signature` is present; full HMAC verification happens in the subgraph after the payment is resolved).
  - `POST /payments/webhook/mercadopago` — MercadoPago IPN (signature TODO).
- **PaymentsService** ([`src/payments/payments.service.ts`](../src/payments/payments.service.ts))
  calls the transactions GraphQL endpoint directly (not through the public
  gateway) for the internal mutations.

## Env vars needed

```
EKORU_TRANSACTIONS_DEV_URL=http://localhost:4006/graphql
INTERNAL_SERVICE_SECRET=<long random; must match transactions>
WEB_APP_BASE_URL=http://localhost:3000   # fallback when Referer header is missing
```

`WEB_APP_BASE_URL` is the origin to redirect the buyer to after a provider
return. The controller prefers the `Referer` header when present (it'll be
the provider's origin only after the buyer pays, so we resolve it via the
session cookie's `NEXT_LOCALE` value).
