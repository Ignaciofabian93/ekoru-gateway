import type { Request, Response } from 'express';
import { metricsGuard } from './metrics-guard';

function run(
  guard: ReturnType<typeof metricsGuard>,
  headers: Record<string, string>,
) {
  const res = {
    status: jest.fn<unknown, [number]>().mockReturnThis(),
    end: jest.fn(),
  };
  const next = jest.fn();
  guard({ headers } as unknown as Request, res as unknown as Response, next);
  return {
    passed: next.mock.calls.length === 1,
    status: res.status.mock.calls[0]?.[0],
  };
}

describe('metricsGuard (GW-1)', () => {
  it('serves a direct scrape from the docker network', () => {
    expect(run(metricsGuard(), {}).passed).toBe(true);
  });

  it('hides metrics from anything that came through nginx', () => {
    expect(run(metricsGuard(), { 'x-forwarded-for': '200.1.2.3' })).toEqual({
      passed: false,
      status: 404,
    });
    expect(run(metricsGuard(), { 'x-real-ip': '200.1.2.3' }).passed).toBe(
      false,
    );
  });

  it('lets a proxied scraper in with the metrics token, and only with it', () => {
    const guard = metricsGuard('s3cret');
    const proxied = { 'x-forwarded-for': '10.0.0.9' };
    expect(
      run(guard, { ...proxied, authorization: 'Bearer s3cret' }).passed,
    ).toBe(true);
    expect(
      run(guard, { ...proxied, authorization: 'Bearer wrong!' }).passed,
    ).toBe(false);
  });
});
