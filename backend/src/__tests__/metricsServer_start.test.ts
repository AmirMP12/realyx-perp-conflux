import { jest } from "@jest/globals";

jest.mock("../config.js", () => ({
  __esModule: true,
  config: { metricsPort: 0, nodeEnv: "test", rpcUrl: "", chainId: 71 },
}));

import request from "supertest";
import type http from "http";
import { startMetricsServer } from "../metricsServer.js";

describe("startMetricsServer", () => {
  let server: http.Server;

  beforeAll((done) => {
    server = startMetricsServer();
    // Port 0 → OS-assigned; wait until it's listening.
    if (server.listening) done();
    else server.on("listening", () => done());
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it("serves Prometheus metrics on /metrics", async () => {
    const res = await request(server).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("process_cpu_user_seconds_total");
  });

  it("serves a JSON health check on /health", async () => {
    const res = await request(server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("serves /healthz as well", async () => {
    const res = await request(server).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await request(server).get("/nope");
    expect(res.status).toBe(404);
  });

  it("logs server errors without crashing the process", () => {
    expect(() => server.emit("error", new Error("EADDRINUSE"))).not.toThrow();
  });
});
