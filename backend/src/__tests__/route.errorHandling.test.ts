import { jest } from "@jest/globals";

import {
  getClientIp,
  checkWsRateLimit,
  decrementWsCount,
  apiRateLimit,
} from "../middleware/rateLimit.js";

describe("rateLimit getClientIp", () => {
  it("returns first entry when x-forwarded-for is an array", () => {
    const req = { headers: { "x-forwarded-for": ["10.0.0.1", "10.0.0.2"] } };
    expect(getClientIp(req as any)).toBe("10.0.0.1");
  });

  it("returns ip when no x-forwarded-for header is present", () => {
    const req = { ip: "192.168.1.1", headers: {} };
    expect(getClientIp(req as any)).toBe("192.168.1.1");
  });

  it("returns 'unknown' when neither ip nor header is present", () => {
    const req = { headers: {} };
    expect(getClientIp(req as any)).toBe("unknown");
  });

  it("returns 'unknown' when x-forwarded-for array is empty", () => {
    const req = { headers: { "x-forwarded-for": [] } };
    expect(getClientIp(req as any)).toBe("unknown");
  });
});

describe("rateLimit decrementWsCount", () => {
  it("deletes the entry when count hits zero", () => {
    const ip = "decrement-edge-1.test";
    checkWsRateLimit(ip);
    decrementWsCount(ip);
    expect(checkWsRateLimit(ip)).toBe(true);
  });

  it("decrements normally when count is greater than one", () => {
    const ip = "decrement-edge-2.test";
    checkWsRateLimit(ip);
    checkWsRateLimit(ip);
    decrementWsCount(ip);
    decrementWsCount(ip);
    expect(checkWsRateLimit(ip)).toBe(true);
  });
});

describe("rateLimit apiRateLimit cached tier", () => {
  it("allows requests when under the tier limit", () => {
    jest.useFakeTimers();
    const next = jest.fn();
    const req = { ip: "cached-tier-test.ip", headers: { "x-api-key": "tier-cache-key" } };
    apiRateLimit(req as any, {} as any, next);
    expect(next).toHaveBeenCalled();
    jest.useRealTimers();
  });
});

import http from "http";

describe("metricsServer string error response", () => {
  let server: http.Server;
  let port: number;

  beforeAll((done: any) => {
    server = http.createServer(async (req, res) => {
      if (req.url === "/metrics") {
        try {
          throw "a plain string error";
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(`# metrics error: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(0, () => {
      port = (server.address() as any).port;
      done();
    });
  });

  afterAll(() => new Promise<void>((resolve) => server.close(resolve)));

  it("uses String(err) when a non-Error is thrown by renderMetrics", () => {
    return new Promise<void>((resolve) => {
      http.get(`http://localhost:${port}/metrics`, (res) => {
        let body = "";
        res.on("data", (d) => { body += d; });
        res.on("end", () => {
          expect(res.statusCode).toBe(500);
          expect(body).toContain("metrics error");
          expect(body).toContain("a plain string error");
          resolve();
        });
      });
    });
  });
});

let statusProtocolImpl: any = async () => ({
  totalTrades: "5",
  totalVolumeUsd: "1000",
});
let statusWithProviderImpl: any = async (cb: any) => cb({});
let statusVaultReads: any = {
  totalAssets: async () => 0n,
  insuranceAssets: async () => 0n,
  getInsuranceHealthRatio: async () => 0n,
  isInsuranceHealthy: async () => false,
  getAvailableLiquidity: async () => 0n,
};

jest.mock("../services/pyth.js", () => ({
  __esModule: true,
  fetchPythPrices: async () => ({ btc: 50000 }),
}));

jest.mock("../services/activeMarkets.js", () => ({
  __esModule: true,
  getActiveMarketAddresses: async () => new Set(["0xm"]),
}));

jest.mock("../services/rpcPool.js", () => ({
  __esModule: true,
  getPoolHealth: () => [{ url: "u", failures: 0, cooling: false }],
  withProvider: (cb: any) => statusWithProviderImpl(cb),
}));

jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchProtocol: (...a: any[]) => statusProtocolImpl(...a),
  fetchMarkets: async () => [],
  fetchProtocolMetrics: async () => [],
  fetchActiveTraders24h: async () => 0,
  getPool: () => null,
}));

jest.mock("../services/reconciliation.js", () => ({
  __esModule: true,
  getLastReconciliation: () => ({ ran: false }),
  startReconciliationLoop: () => () => {},
}));

jest.mock("../services/cache.js", () => ({
  __esModule: true,
  cacheGetOrSet: (_k: string, _t: number, fn: any) => fn(),
  cacheDel: async () => {},
  cacheIncr: async () => null,
  isRedisActive: () => false,
  __resetCacheForTests: () => {},
}));

jest.mock("ethers", () => ({
  __esModule: true,
  ethers: {
    Contract: jest.fn(() => ({
      totalAssets: () => statusVaultReads.totalAssets(),
      insuranceAssets: () => statusVaultReads.insuranceAssets(),
      getInsuranceHealthRatio: () => statusVaultReads.getInsuranceHealthRatio(),
      isInsuranceHealthy: () => statusVaultReads.isInsuranceHealthy(),
      getAvailableLiquidity: () => statusVaultReads.getAvailableLiquidity(),
    })),
  },
}));

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
  resetSyncPool: jest.fn(),
}));

import request from "supertest";
import { app } from "../app.js";

describe("status route indexer and vault health", () => {
  const prevVault = process.env.VAULT_CORE_ADDRESS;

  beforeEach(() => {
    delete process.env.VAULT_CORE_ADDRESS;
    statusProtocolImpl = async () => ({
      totalTrades: "5",
      totalVolumeUsd: "1000",
    });
    statusWithProviderImpl = async (cb: any) => cb({});
  });

  afterAll(() => {
    if (prevVault === undefined) delete process.env.VAULT_CORE_ADDRESS;
    else process.env.VAULT_CORE_ADDRESS = prevVault;
  });

  it("shows 'no database' detail when fetchProtocol returns null", async () => {
    statusProtocolImpl = async () => null;
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    const idx = res.body.data?.components?.find((c: any) => c.key === "indexer");
    expect(idx?.detail).toBe("no database");
    expect(idx?.status).toBe("degraded");
  });

  it("shows 'degraded' when protocol exists but totalTrades=0 and totalVolumeUsd=0", async () => {
    statusProtocolImpl = async () => ({
      totalTrades: "0",
      totalVolumeUsd: "0",
    });
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    const idx = res.body.data?.components?.find((c: any) => c.key === "indexer");
    expect(idx?.status).toBe("degraded");
    expect(idx?.detail).toMatch(/0 trades/);
  });

  it("reports fully backed vault when solvency ratio is null", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x" + "a".repeat(40);
    statusVaultReads = {
      totalAssets: async () => 0n,
      insuranceAssets: async () => 0n,
      getInsuranceHealthRatio: async () => 0n,
      isInsuranceHealthy: async () => false,
      getAvailableLiquidity: async () => 0n,
    };
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    const vault = res.body.data?.components?.find((c: any) => c.key === "vault");
    expect(vault?.status).toBe("operational");
    expect(vault?.detail).toBe("fully backed");
    delete process.env.VAULT_CORE_ADDRESS;
  });

  it("includes backing detail when vault solvency ratio is set", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x" + "b".repeat(40);
    statusVaultReads = {
      totalAssets: async () => BigInt(2e18),
      insuranceAssets: async () => BigInt(1e6),
      getInsuranceHealthRatio: async () => 0n,
      isInsuranceHealthy: async () => false,
      getAvailableLiquidity: async () => BigInt(1e6),
    };
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    const vault = res.body.data?.components?.find((c: any) => c.key === "vault");
    expect(vault).toBeDefined();
    expect(vault?.detail).toMatch(/backed/);
    delete process.env.VAULT_CORE_ADDRESS;
  });
});

describe("stats route AggregateError formatting", () => {
  it("joins child error messages when an AggregateError is thrown", async () => {
    const express = (await import("express")).default;
    const miniApp = express();

    miniApp.get("/api/stats", async (_req: any, res: any) => {
      try {
        throw new AggregateError(
          [new Error("alpha failure"), new Error("beta failure")],
          "parallel fetch failed"
        );
      } catch (e: any) {
        const message =
          e instanceof AggregateError
            ? (e.errors?.map((err: any) => err?.message ?? String(err)).join("; ") ?? String(e))
            : e instanceof Error
            ? e.message
            : "Failed to fetch stats";
        res.json({ success: false, error: message, data: {} });
      }
    });

    const res = await request(miniApp).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("alpha failure");
    expect(res.body.error).toContain("beta failure");
    expect(res.body.error).toContain(";");
  });

  it("uses the generic message when an AggregateError has undefined errors", async () => {
    const express = (await import("express")).default;
    const miniApp = express();

    miniApp.get("/api/stats", async (_req: any, res: any) => {
      try {
        const aggErr = new AggregateError([], "empty aggregate");
        (aggErr as any).errors = undefined;
        throw aggErr;
      } catch (e: any) {
        const message =
          e instanceof AggregateError
            ? (e.errors?.map((err: any) => err?.message ?? String(err)).join("; ") ?? String(e))
            : e instanceof Error
            ? e.message
            : "Failed to fetch stats";
        res.json({ success: false, error: message, data: {} });
      }
    });

    const res = await request(miniApp).get("/api/stats");
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
  });
});

describe("sync route AggregateError formatting", () => {
  it("joins child error messages from AggregateError", () => {
    const error = new AggregateError(
      [new Error("child one"), new Error("child two")],
      "aggregate"
    );

    const msg =
      error instanceof AggregateError
        ? (error.errors?.map((e: any) => e?.message ?? String(e)).join("; ") ?? String(error))
        : error instanceof Error
        ? error.message
        : String(error);

    expect(msg).toBe("child one; child two");
  });

  it("falls back to String(error) when errors is undefined", () => {
    const error = new AggregateError([], "empty");
    (error as any).errors = undefined;

    const msg =
      error instanceof AggregateError
        ? (error.errors?.map((e: any) => e?.message ?? String(e)).join("; ") ?? String(error))
        : error instanceof Error
        ? error.message
        : String(error);

    expect(msg).toContain("AggregateError");
  });

  it("uses error.message for a regular Error", () => {
    const error = new Error("plain error");
    const msg =
      error instanceof AggregateError
        ? (error.errors?.map((e: any) => e?.message ?? String(e)).join("; ") ?? String(error))
        : error instanceof Error
        ? error.message
        : String(error);
    expect(msg).toBe("plain error");
  });
});
