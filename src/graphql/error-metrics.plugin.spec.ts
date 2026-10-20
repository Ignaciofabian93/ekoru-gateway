import { register } from 'prom-client';
import { graphqlMetricsPlugin } from './error-metrics.plugin';

type Hooks = {
  didEncounterErrors(ctx: unknown): Promise<void>;
  willSendResponse(ctx: unknown): Promise<void>;
};

async function value(name: string, labels: Record<string, string>) {
  const metric = await register.getSingleMetric(name)?.get();
  return metric?.values.find((v) =>
    Object.entries(labels).every(([k, l]) => v.labels[k] === l),
  )?.value;
}

describe('graphqlMetricsPlugin (INF-5)', () => {
  it('counts requests by outcome and errors by code', async () => {
    const plugin = graphqlMetricsPlugin();
    const start = plugin.requestDidStart as unknown as () => Promise<Hooks>;

    const failed = await start();
    await failed.didEncounterErrors({
      errors: [
        { extensions: { code: 'DOWNSTREAM_SERVICE_ERROR' } },
        { extensions: {} },
      ],
    });
    await failed.willSendResponse({ errors: [{}] });
    const ok = await start();
    await ok.willSendResponse({ errors: undefined });

    expect(
      await value('ekoru_graphql_errors_total', {
        code: 'DOWNSTREAM_SERVICE_ERROR',
      }),
    ).toBe(1);
    expect(await value('ekoru_graphql_errors_total', { code: 'UNKNOWN' })).toBe(
      1,
    );
    expect(
      await value('ekoru_graphql_requests_total', { outcome: 'error' }),
    ).toBe(1);
    expect(await value('ekoru_graphql_requests_total', { outcome: 'ok' })).toBe(
      1,
    );
  });
});
