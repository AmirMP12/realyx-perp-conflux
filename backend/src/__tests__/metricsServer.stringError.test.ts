import { jest } from "@jest/globals";

jest.mock("../middleware/metrics.js", () => ({
  __esModule: true,
  renderMetrics: async () => {
    throw "plain string error from renderMetrics";
  },
  metricsMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../config.js", () => ({
  __esModule: true,
  config: {
    metricsPort: 0,
    nodeEnv: "test",
    rpcUrl: "http://localhost:8545",
    chainId: 71,
  },
}));

import { startMetricsServer } from "../metricsServer.js";
import http from "http";

describe("metricsServer string error handling", () => {
  let server: http.Server;
  let port: number;

  beforeAll(() => {
    return new Promise<void>((resolve) => {
      server = startMetricsServer();
      if ((server as any).listening) {
        port = (server.address() as any).port;
        resolve();
      } else {
        server.on("listening", () => {
          port = (server.address() as any).port;
          resolve();
        });
      }
    });
  });

  afterAll(() => new Promise<void>((resolve) => server.close(resolve)));

  it("responds 500 and stringifies non-Error throws from renderMetrics", () => {
    return new Promise<void>((resolve, reject) => {
      http.get(`http://localhost:${port}/metrics`, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            expect(res.statusCode).toBe(500);
            expect(body).toContain("metrics error");
            expect(body).toContain("plain string error from renderMetrics");
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }).on("error", reject);
    });
  });
});
