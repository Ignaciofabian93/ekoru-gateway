import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Keeps `/metrics` off the public internet (GW-1).
 *
 * Prometheus scrapes the gateway container directly on the docker network;
 * every public request reaches it through nginx, which always sets
 * `X-Forwarded-For` (the gateway's `trust proxy` setting depends on it). So a
 * request that came through the proxy gets a 404, as if the route did not
 * exist, unless it carries `Authorization: Bearer <METRICS_TOKEN>` for a
 * scraper that has to go through the proxy. Without a token configured, only
 * direct (internal) requests get metrics.
 */
export function metricsGuard(token?: string) {
  const expected = token ? Buffer.from(`Bearer ${token}`) : null;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (expected) {
      const given = Buffer.from(req.headers.authorization ?? '');
      if (
        given.length === expected.length &&
        timingSafeEqual(given, expected)
      ) {
        next();
        return;
      }
    }
    if (req.headers['x-forwarded-for'] || req.headers['x-real-ip']) {
      res.status(404).end();
      return;
    }
    next();
  };
}
