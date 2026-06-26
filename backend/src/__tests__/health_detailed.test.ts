import { jest } from "@jest/globals";

let protocolImpl: any = async () => ({});
let pythImpl: any = async () => ({ a: 1 });
let activeImpl: any = async () => new Set(["0xm"]);
let poolHealthImpl: any = () => [{ url: "https://good.example/rpc", failures: 0, cooling: false, state: "closed" }];

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchProtocol: (...a: any[]) => protocolImpl(...a),
  getPool: () => null,
}));
jest.mock("../services/pyth.js", () => ({
  __esModule: true,
  fetchPythPrices: (...a: any[]) => pythImpl(...a),
}));
jest.mock("../services/activeMarkets.js", () => ({
  __esModule: true,
  getActiveMarketAddresses: (...a: any[]) => activeImpl(...a),
}));
jest.mock("../services/rpcPool.js", () => ({
  __esModule: true,
  getPoolHealth: (...a: any[]) => poolHealthImpl(...a),
}));

import request from "supertest";
import { app } from "../app.js";

describe("health detailed route", () => {
  beforeEach(() => {
    protocolImpl = async () => ({});
    pythImpl = async () => ({ a: 1 });
    activeImpl = async () => new Set(["0xm"]);
    poolHealthImpl = () => [{ url: "https://good.example/rpc", failures: 0, cooling: false, state: "closed" }];
  });

  it("liveness returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.body.ok).toBe(true);
  });

  it("reports all checks healthy (200)", async () => {
    const res = await request(app).get("/health/detailed");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks.indexer.ok).toBe(true);
    expect(res.body.rpcPool[0].endpoint).toBe("good.example");
  });

  it("returns 503 when the indexer check fails", async () => {
    protocolImpl = async () => { throw new Error("indexer down"); };
    const res = await request(app).get("/health/detailed");
    expect(res.status).toBe(503);
    expect(res.body.checks.indexer.ok).toBe(false);
  });

  it("returns 503 when pyth and rpc checks fail", async () => {
    pythImpl = async () => { throw new Error("pyth down"); };
    activeImpl = async () => { throw new Error("rpc down"); };
    const res = await request(app).get("/health/detailed");
    expect(res.status).toBe(503);
    expect(res.body.checks.pyth.ok).toBe(false);
    expect(res.body.checks.rpc.ok).toBe(false);
  });

  it("renders 'invalid' for an unparseable rpc endpoint url", async () => {
    poolHealthImpl = () => [{ url: "::bad::", failures: 1, cooling: true, state: "open" }];
    const res = await request(app).get("/health/detailed");
    expect(res.body.rpcPool[0].endpoint).toBe("invalid");
  });
});
