# Supergraph composition

The gateway is an Apollo Federation router. It has no schema of its own: at boot
it introspects every subgraph listed in `src/app.module.ts` and composes their
SDL into one supergraph.

That has a failure mode worth understanding before touching anything here.

## The failure mode

`IntrospectAndCompose` builds the subgraph list from environment variables and
then **drops the entries with no URL**:

```ts
const subgraphs = [
  { name: 'users', url: getServiceUrl('USERS') },
  // …
].filter((s) => s.url);
```

So a missing `EKORU_STORES_STAGING_URL`, or a stores container that was down at
the moment the gateway booted, does not stop the router. It comes up happily —
just without stores. Every stores query then fails at request time with
`Cannot query field …`, which reads like a client bug and is not.

Two rules follow:

1. **A subgraph deploy that adds or changes an operation needs a gateway
   restart.** The supergraph is composed once, at boot. New fields do not appear
   until the router introspects again.
2. **Always smoke-test after a deploy** — the router will not tell you what is
   missing.

## Subgraph registry

| Subgraph         | Env var (per environment)              | Port | Notes                                        |
| ---------------- | -------------------------------------- | ---- | -------------------------------------------- |
| `users`          | `EKORU_USERS_<ENV>_URL`                | 4001 | Sellers, account, notifications, mail        |
| `marketplace`    | `EKORU_MARKETPLACE_<ENV>_URL`          | 4002 | P2P products, catalog, impact records        |
| `stores`         | `EKORU_STORES_<ENV>_URL`               | 4003 | Store products                               |
| `services`       | `EKORU_SERVICES_<ENV>_URL`             | 4004 | Services, bookings, quotations, reviews      |
| `blog-community` | `EKORU_BLOG_COMMUNITY_<ENV>_URL`       | 4005 | Blog + community (read-only today)           |
| `search`         | `EKORU_SEARCH_<ENV>_URL`               | 4006 | Postgres-backed search                       |
| `transactions`   | `EKORU_TRANSACTIONS_<ENV>_URL`         | 4007 | Orders, payments, P2P deals                  |

`<ENV>` is `DEV`, `STAGING` or `PROD`, chosen by the `ENVIRONMENT` variable
(`development` → `DEV`). Values are the in-network container URLs, e.g.
`http://ekoru-users-staging:4001/graphql`.

`ekoru-image-processor` is **not** a subgraph — the gateway calls it over REST
(`IMAGE_PROCESSOR_URL`, see `docs/IMAGE_PROCESSOR_INTEGRATION.md`).

### Checking the env wiring

The variable name has to match the environment's prefix, and nothing validates
that: a key spelled for the wrong environment reads as "not configured", and the
subgraph is silently dropped. This has already happened once — `.env.prod`
carried `EKORU_TRANSACTIONS_STAGING_URL`, so production composed without the
transactions subgraph (no orders, payments or deals) while every file looked
plausible at a glance.

Before a deploy, count and eyeball the keys:

```bash
grep -o 'EKORU_[A-Z_]*_URL' .env.prod | sort   # expect 7, all with the same prefix
grep '^ENVIRONMENT' .env.prod                  # prefix must match: production → PROD
```

## Recompose / redeploy

Recomposing means restarting the router once every subgraph it should see is up:

```bash
# on the server, from the gateway repo
docker compose -f compose.staging.yml up -d --build      # or compose.prod.yml
docker compose -f compose.staging.yml logs -f ekoru-gateway-staging
```

The log line to look for is Apollo reporting the composed subgraphs. If a
subgraph was unreachable, the router still starts — which is exactly why the
next step is not optional.

Order of operations for a change that spans a subgraph and the router:

1. Deploy the subgraph(s).
2. Confirm each one answers on its own `/graphql` (its container health check).
3. Restart the gateway.
4. Run the smoke test.

## Smoke test

```bash
npm run smoke -- https://api.staging.ekoru.cl/graphql
# or
GATEWAY_GRAPHQL_URL=https://api.ekoru.cl/graphql npm run smoke
```

`scripts/smoke-supergraph.mjs` does two passes:

- **Composition** — introspects the router and asserts the root fields each
  subgraph contributes are present, including recently added ones
  (`resetPassword`, `getOrdersByBuyer`, the P2P deal operations, notifications).
  A whole subgraph missing shows up as every one of its fields missing.
- **Liveness** — runs one real query per subgraph, selecting only `__typename`,
  so it proves the router can reach and execute against each service without
  depending on any data existing.

It exits non-zero on the first failing check, so it can gate a deploy step.

When you add an operation that clients depend on, add it to the `expect` list
for its subgraph in that script. The point of the list is to catch a stale
supergraph, and it can only catch what it knows to look for.

## Auth through the router

The router does not gate operations. `AuthenticatedDataSource`
(`src/app.module.ts`) forwards the caller's identity to every subgraph as
headers derived from the JWT in the `token` cookie or the `Authorization`
header; the subgraphs decide what an anonymous caller may do via
`@CurrentSeller` / `@CurrentAdmin`.

A consequence worth remembering: a mutation is public purely because its
resolver does not require a seller. `requestPasswordReset` and `resetPassword`
are public by design — they run before the user has a session.
