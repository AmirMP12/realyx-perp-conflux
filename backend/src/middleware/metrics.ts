/**
 * Simple request metrics - logs latency and errors.
 */

import type { Request, Response, NextFunction } from "express";

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const latencyMs = Date.now() - start;
    const status = res.statusCode;
    const method = req.method;
    const path = req.route?.path ?? req.path;
    if (status >= 500) {
      console.warn(`[metrics] ${method} ${path} ${status} ${latencyMs}ms`);
    } else if (process.env.NODE_ENV === "development" && latencyMs > 1000) {
      console.info(`[metrics] ${method} ${path} ${status} ${latencyMs}ms (slow)`);
    }
  });
  next();
}
