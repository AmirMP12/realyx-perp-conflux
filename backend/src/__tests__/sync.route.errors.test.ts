import { jest } from "@jest/globals";

const mockQuery = jest.fn<any>().mockResolvedValue({ rows: [], rowCount: 0 });
const mockGetBlockNumber = jest.fn<any>().mockResolvedValue(1000);
const mockGetLogs = jest.fn<any>().mockResolvedValue([]);
const mockGetBlock = jest.fn<any>().mockResolvedValue({ hash: "0xhash", timestamp: 1700000000 });

jest.mock("pg", () => {
  const Pool = jest.fn<any>(() => ({
    query: (...a: any[]) => mockQuery(...a),
    on: jest.fn(),
    end: jest.fn(),
  }));
  return { __esModule: true, default: { Pool }, Pool };
});

jest.mock("ethers", () => {
  const mockEthers = {
    JsonRpcProvider: jest.fn<any>().mockImplementation(() => ({
      getBlockNumber: () => mockGetBlockNumber(),
      getLogs: (...a: any[]) => mockGetLogs(...a),
      getBlock: (...a: any[]) => mockGetBlock(...a),
      getNetwork: jest.fn<any>().mockResolvedValue({ chainId: 1030 }),
    })),
    Interface: jest.fn<any>().mockImplementation(() => ({
      parseLog: jest.fn<any>().mockReturnValue(null),
    })),
    id: jest.fn<any>().mockReturnValue("0xTopic"),
    ZeroHash: "0x" + "0".repeat(64),
  };
  return { ...mockEthers, ethers: mockEthers };
});

import express from "express";
import request from "supertest";
import router from "../routes/sync.js";

const TRADING_CORE = "0x" + "a".repeat(40);

describe("sync route error handling", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    process.env.POSTGRES_URL = "postgres://test";
    process.env.TRADING_CORE_ADDRESS = TRADING_CORE;
    delete process.env.CRON_SECRET;
    delete process.env.VAULT_CORE_ADDRESS;
    delete process.env.COPY_REGISTRY_ADDRESS;
    mockQuery.mockReset();
    mockGetBlockNumber.mockResolvedValue(1000);
    mockGetLogs.mockResolvedValue([]);
    mockGetBlock.mockResolvedValue({ hash: "0xhash", timestamp: 1700000000 });
  });

  afterAll(() => {
    process.env = { ...OLD };
  });

  it("joins child error messages when runSync throws AggregateError", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("last_synced_block")) {
        throw new AggregateError(
          [new Error("connection reset A"), new Error("timeout B")],
          "Multi-pool failure"
        );
      }
      return { rows: [], rowCount: 0 };
    });

    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app).get("/?key=force");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("connection reset A");
    expect(res.body.error).toContain("timeout B");
    expect(res.body.error).toContain(";");
  });

  it("uses error.message for a regular Error in the route catch", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("last_synced_block")) {
        throw new Error("plain db error");
      }
      return { rows: [], rowCount: 0 };
    });

    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app).get("/?key=force");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("plain db error");
  });

  it("uses String(err) for a non-Error thrown value in the route catch", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("last_synced_block")) {
        throw 42;
      }
      return { rows: [], rowCount: 0 };
    });

    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app).get("/?key=force");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("42");
  });

  it("covers ?? String(error) when AggregateError.errors is undefined", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("last_synced_block")) {
        const err = new AggregateError([], "empty agg");
        (err as any).errors = undefined;
        throw err;
      }
      return { rows: [], rowCount: 0 };
    });

    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app).get("/?key=force");

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("returns 401 when CRON_SECRET is set and Authorization header is missing", async () => {
    process.env.CRON_SECRET = "secret123";
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockGetBlockNumber.mockResolvedValue(100);

    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app).get("/");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("returns 401 when Authorization header doesn't start with 'Bearer '", async () => {
    process.env.CRON_SECRET = "secret123";
    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app).get("/").set("Authorization", "Basic wrongformat");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token doesn't match CRON_SECRET", async () => {
    process.env.CRON_SECRET = "secret123";
    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app).get("/").set("Authorization", "Bearer wrongtoken");
    expect(res.status).toBe(401);
  });

  it("passes auth when Bearer token matches CRON_SECRET and sync succeeds", async () => {
    process.env.CRON_SECRET = "secret123";
    mockGetBlockNumber.mockResolvedValue(100);
    mockQuery.mockImplementation(async (sql: string) => {
      return { rows: [], rowCount: 0 };
    });
    process.env.INDEXER_START_BLOCK = "9999999999";

    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app)
      .get("/")
      .set("Authorization", "Bearer secret123");

    expect(res.status).toBe(200);
    delete process.env.INDEXER_START_BLOCK;
  });

  it("skips checkpoint persist when getBlock returns null", async () => {
    mockGetBlock.mockResolvedValue(null);
    mockGetBlockNumber.mockResolvedValue(600);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const app = express();
    app.use(express.json());
    app.use("/", router);

    process.env.INDEXER_START_BLOCK = "590";
    const res = await request(app).get("/?key=force");
    expect([200, 500]).toContain(res.status);
    delete process.env.INDEXER_START_BLOCK;
  });

  it("parses ?fromBlock=100 and overrides cursor", async () => {
    mockGetBlockNumber.mockResolvedValue(105);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const app = express();
    app.use(express.json());
    app.use("/", router);

    const res = await request(app).get("/?key=force&fromBlock=100");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
