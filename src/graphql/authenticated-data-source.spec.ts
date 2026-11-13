import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GraphQLDataSourceProcessOptions } from '@apollo/gateway';
import { AuthenticatedDataSource } from './authenticated-data-source';

/** A subgraph that answers after `delayMs`, and records what it was sent. */
function slowSubgraph(delayMs: number) {
  const seen: Array<Record<string, string | string[] | undefined>> = [];
  const pending = new Set<NodeJS.Timeout>();
  const server: Server = createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    const timer = setTimeout(() => {
      pending.delete(timer);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: { ok: true } }));
    }, delayMs);
    pending.add(timer);
  });
  return {
    seen,
    listen: () =>
      new Promise<string>((resolve) =>
        server.listen(0, '127.0.0.1', () =>
          resolve(
            `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`,
          ),
        ),
      ),
    close: () =>
      new Promise<void>((resolve) => {
        pending.forEach((timer) => clearTimeout(timer));
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const incoming = (
  operation: 'query' | 'mutation',
  context: Record<string, unknown> = {},
) =>
  ({
    kind: 'incoming operation',
    request: { query: `${operation} { ok }` },
    context,
    incomingRequestContext: { operation: { operation } },
  }) as unknown as GraphQLDataSourceProcessOptions<Record<string, any>>;

const loadingSchema = () =>
  ({
    kind: 'loading schema',
    request: { query: '{ _service { sdl } }' },
    context: {},
  }) as unknown as GraphQLDataSourceProcessOptions<Record<string, any>>;

describe('AuthenticatedDataSource timeouts (INF-24)', () => {
  // The subgraph takes 300 ms: longer than a read may, shorter than a write.
  const subgraph = slowSubgraph(300);
  const timeouts = { queryMs: 100, mutationMs: 2_000 };
  let source: AuthenticatedDataSource;

  beforeAll(async () => {
    source = new AuthenticatedDataSource(
      { url: await subgraph.listen() },
      'jwt-secret',
      timeouts,
    );
  });

  afterAll(() => subgraph.close());

  it('gives up on a read that takes longer than its limit', async () => {
    const started = Date.now();

    await expect(source.process(incoming('query'))).rejects.toThrow(/abort/i);

    // It stopped at the limit instead of waiting for the answer.
    expect(Date.now() - started).toBeLessThan(290);
  });

  it('lets a write take longer than a read', async () => {
    const result = await source.process(incoming('mutation'));

    expect(result.data).toEqual({ ok: true });
  });

  it("gives loading the schema at boot the writes' limit", async () => {
    const result = await source.process(loadingSchema());

    expect(result.data).toEqual({ ok: true });
  });

  it('still sends the visitor address and never a caller-chosen one', async () => {
    subgraph.seen.length = 0;

    await source.process(incoming('mutation', { clientIp: '203.0.113.7' }));

    expect(subgraph.seen[0]['x-client-ip']).toBe('203.0.113.7');
    expect(subgraph.seen[0]['x-internal-secret']).toBeUndefined();
  });
});
