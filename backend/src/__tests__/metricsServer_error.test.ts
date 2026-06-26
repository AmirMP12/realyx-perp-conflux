import { jest } from "@jest/globals";

jest.mock("../config.js", () => ({
  __esModule: true,
  config: { metricsPort: 0, nodeEnv: "test", rpcUrl: "", chainId: 71 },
}));

jest.mock("../middleware/metrics.js", () => ({
  __esModule: true,
  renderMetrics: async () => {
    throw new Error("render fail");
  },
}));

import request from "supertest";
import type http from "http";
import { startMetricsServer } from "../metricsServer.js";

describe("startMetricsServer (error path)", () => {
  let server: http.Server;

  beforeAll((done) => {
    server = startMetricsServer();
    if (server.listening) done();
    else server.on("listening", () => done());
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it("returns 500 when metrics rendering throws", async () => {
    const res = await request(server).get("/metrics");
    expect(res.status).toBe(500);
    expect(res.text).toContain("metrics error");
  });

  it("still serves the health endpoint", async () => {
    const res = await request(server).get("/health");
    expect(res.status).toBe(200);
  });
});
