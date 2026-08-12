#!/usr/bin/env node
/**
 * Supergraph smoke test.
 *
 * The gateway composes its schema at boot with IntrospectAndCompose: if a
 * subgraph is down, or its URL is missing from the environment, the router
 * silently comes up *without* it and every one of its operations 404s at query
 * time. Nothing fails loudly. This script is the check — run it after every
 * gateway or subgraph deploy.
 *
 * It does two passes:
 *   1. Composition — introspects the router and asserts the root fields each
 *      subgraph is expected to contribute are present.
 *   2. Liveness — executes one real query per subgraph (`__typename` only, so
 *      it stays cheap and does not depend on data being there).
 *
 * Usage:
 *   node scripts/smoke-supergraph.mjs [gatewayGraphqlUrl]
 *   GATEWAY_GRAPHQL_URL=https://api.staging.ekoru.cl/graphql node scripts/smoke-supergraph.mjs
 *
 * Exit code is 1 if anything is missing, so CI or a deploy step can gate on it.
 */

const url =
  process.argv[2] ??
  process.env.GATEWAY_GRAPHQL_URL ??
  'http://localhost:4000/graphql';

/**
 * One entry per subgraph. `expect` lists root fields that must survive
 * composition — enough to prove the subgraph is in, including the operations
 * most recently added, which are exactly the ones a stale supergraph loses.
 */
const SUBGRAPHS = [
  {
    name: 'users',
    expect: {
      Query: [
        'countries',
        'myNotifications',
        'unreadNotificationCount',
        'mySubscription',
      ],
      Mutation: ['requestPasswordReset', 'resetPassword', 'updatePassword'],
    },
    probe: '{ countries(language: ES) { __typename } }',
  },
  {
    name: 'marketplace',
    expect: {
      Query: ['getProducts', 'getProductById', 'getMarketplaceCatalog'],
      Mutation: ['addProduct'],
    },
    probe: '{ getProducts(page: 1, pageSize: 1) { __typename } }',
  },
  {
    name: 'stores',
    expect: {
      Query: [
        'getStoreProducts',
        'getStoreProductById',
        'getStoreCatalog',
        'getStoreProductReviews',
      ],
      Mutation: ['addStoreProduct', 'addStoreProductReview'],
    },
    probe: '{ getStoreProducts(page: 1, pageSize: 1) { __typename } }',
  },
  {
    name: 'services',
    expect: {
      Query: [
        'getServices',
        'getService',
        'getServiceCatalog',
        'myServiceBookings',
        'myQuotations',
      ],
      Mutation: ['addServiceBooking', 'addQuotation', 'addServiceReview'],
    },
    probe: '{ getServices(page: 1, pageSize: 1) { __typename } }',
  },
  {
    name: 'blog-community',
    expect: {
      Query: ['getBlogCatalog', 'getCommunityCatalog', 'communityEvents'],
      Mutation: ['createMyCommunityEvent', 'registerForCommunityEvent'],
    },
    probe: '{ getBlogCatalog(language: ES) { __typename } }',
  },
  {
    name: 'search',
    expect: {
      Query: ['search', 'autocomplete', 'trending'],
      Mutation: [],
    },
    probe: '{ trending { __typename } }',
  },
  {
    name: 'transactions',
    expect: {
      // getOrdersByBuyer backs the web order history; the deal queries back the
      // P2P inbox — both were added after the first supergraph was published.
      Query: ['getOrdersByBuyer', 'payment', 'myDealsAsBuyer', 'p2pDealSettings'],
      Mutation: ['createOrder', 'createPayment', 'proposeSaleDeal'],
    },
    probe: '{ p2pDealSettings { __typename } }',
  },
];

const INTROSPECTION = `
  query RootFields {
    __schema {
      queryType { fields { name } }
      mutationType { fields { name } }
    }
  }
`;

async function gql(query) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function bullet(ok) {
  return ok ? '  ok  ' : ' FAIL ';
}

async function main() {
  console.log(`Supergraph smoke test → ${url}\n`);

  let introspection;
  try {
    introspection = await gql(INTROSPECTION);
  } catch (error) {
    console.error(`Could not reach the gateway: ${error.message}`);
    process.exit(1);
  }

  if (introspection.errors?.length) {
    console.error('Introspection failed:');
    for (const e of introspection.errors) console.error(`  - ${e.message}`);
    console.error(
      '\nIntrospection is disabled in this environment, or the router failed to compose.',
    );
    process.exit(1);
  }

  const schema = introspection.data.__schema;
  const queryFields = new Set(schema.queryType?.fields?.map((f) => f.name) ?? []);
  const mutationFields = new Set(
    schema.mutationType?.fields?.map((f) => f.name) ?? [],
  );

  let failures = 0;

  console.log('Composition');
  for (const subgraph of SUBGRAPHS) {
    const missing = [
      ...subgraph.expect.Query.filter((f) => !queryFields.has(f)).map(
        (f) => `Query.${f}`,
      ),
      ...subgraph.expect.Mutation.filter((f) => !mutationFields.has(f)).map(
        (f) => `Mutation.${f}`,
      ),
    ];
    const ok = missing.length === 0;
    if (!ok) failures++;
    console.log(`[${bullet(ok)}] ${subgraph.name}`);
    for (const field of missing) console.log(`          missing: ${field}`);
  }

  console.log('\nLiveness');
  for (const subgraph of SUBGRAPHS) {
    let ok = false;
    let detail = '';
    try {
      const result = await gql(subgraph.probe);
      ok = !result.errors?.length;
      detail = result.errors?.[0]?.message ?? '';
    } catch (error) {
      detail = error.message;
    }
    if (!ok) failures++;
    console.log(`[${bullet(ok)}] ${subgraph.name}`);
    if (detail) console.log(`          ${detail}`);
  }

  if (failures > 0) {
    console.error(
      `\n${failures} check(s) failed. If a whole subgraph is missing, confirm its ` +
        `EKORU_<NAME>_<ENV>_URL is set and the service is up, then restart the ` +
        `gateway to recompose (see docs/SUPERGRAPH.md).`,
    );
    process.exit(1);
  }

  console.log('\nAll subgraphs composed and answering.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
