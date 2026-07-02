import { jest } from "@jest/globals";

const mockClient = {
  query: jest.fn<any>(),
  release: jest.fn<any>(),
};
const mockPool = {
  query: jest.fn<any>().mockResolvedValue({ rows: [] }),
  on: jest.fn(),
  connect: jest.fn<any>().mockResolvedValue(mockClient),
};

jest.mock("pg", () => ({
  __esModule: true,
  Pool: jest.fn(() => mockPool),
  default: { Pool: jest.fn(() => mockPool) },
}));

const mockProvider = {
  getBlockNumber: jest.fn<any>().mockResolvedValue(1000),
  getLogs: jest.fn<any>().mockResolvedValue([]),
  getBlock: jest.fn<any>().mockResolvedValue({ number: 1, hash: "0x" + "a".repeat(64), timestamp: 1713400000 }),
  getNetwork: jest.fn<any>().mockResolvedValue({ chainId: 71 }),
};

jest.mock("ethers", () => {
  const original = jest.requireActual("ethers") as any;
  return {
    ...original,
    ethers: {
      ...original.ethers,
      JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
      Interface: original.ethers.Interface,
      id: original.ethers.id,
    },
    JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
  };
});

const HASH_A = "0x" + "a".repeat(64);
const HASH_B = "0x" + "b".repeat(64);

import request from "supertest";
import type { Express } from "express";

describe("sync route", () => {
  let sync: typeof import("../routes/sync.js");
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [{ locked: true }] });
    mockClient.release.mockReset();
    mockProvider.getLogs.mockResolvedValue([]);
    mockProvider.getBlockNumber.mockResolvedValue(1000);
    mockProvider.getBlock.mockResolvedValue({ number: 1, hash: HASH_A, timestamp: 1713400000 });
    process.env.POSTGRES_URL = "postgres://local";
    process.env.TRADING_CORE_ADDRESS = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
    process.env.NODE_ENV = "test";
    process.env.INDEXER_REORG_BUFFER = "64";
    delete process.env.INDEXER_START_BLOCK;
    delete process.env.VAULT_CORE_ADDRESS;
    delete process.env.DEPLOYED_VAULT_CORE;
    delete process.env.CRON_SECRET;
    sync = await import("../routes/sync.js");
    sync.resetSyncPool();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("throws when the database is not configured", async () => {
    // Empty (but present) so dotenv won't repopulate it from .env on reload.
    process.env.POSTGRES_URL = "";
    jest.resetModules();
    const fresh = await import("../routes/sync.js");
    await expect(fresh.runSync()).rejects.toThrow("Database not configured");
  });

  it("throws when the trading core address is missing", async () => {
    delete process.env.TRADING_CORE_ADDRESS;
    delete process.env.DEPLOYED_TRADING_CORE;
    await expect(sync.runSync()).rejects.toThrow(/TRADING_CORE_ADDRESS/);
  });

  it("falls back to a fixed-window rewind when the checkpoint read fails", async () => {
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block FROM indexer_state")) {
        return Promise.resolve({ rows: [{ last_synced_block: 900 }] });
      }
      if (sql.includes("FROM block_checkpoints") && sql.includes("ORDER BY block_number DESC")) {
        return Promise.reject(new Error("checkpoint read failed"));
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await sync.runSync();
    expect(result.scannedFrom).toBe(837); // 900 + 1 - 64
  });

  it("falls back conservatively when getBlock fails mid reorg-walk", async () => {
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block FROM indexer_state")) {
        return Promise.resolve({ rows: [{ last_synced_block: 900 }] });
      }
      if (sql.includes("FROM block_checkpoints") && sql.includes("ORDER BY block_number DESC")) {
        return Promise.resolve({ rows: [{ block_number: 900, block_hash: HASH_A }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockProvider.getBlock.mockImplementation((bn: number) => {
      if (bn === 900) return Promise.reject(new Error("no header"));
      return Promise.resolve({ number: bn, hash: HASH_A, timestamp: 1713400000 });
    });
    const result = await sync.runSync();
    expect(result.scannedFrom).toBe(837);
  });

  it("re-scans the whole retained window on a reorg deeper than retention", async () => {
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block FROM indexer_state")) {
        return Promise.resolve({ rows: [{ last_synced_block: 900 }] });
      }
      if (sql.includes("FROM block_checkpoints") && sql.includes("ORDER BY block_number DESC")) {
        return Promise.resolve({
          rows: [
            { block_number: 900, block_hash: HASH_A },
            { block_number: 899, block_hash: HASH_A },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    // Every block has a different canonical hash → no checkpoint ever matches.
    mockProvider.getBlock.mockImplementation((bn: number) =>
      Promise.resolve({ number: bn, hash: HASH_B, timestamp: 1713400000 })
    );
    const result = await sync.runSync();
    expect(result.reorgDepth).toBe(2);
    expect(result.scannedFrom).toBe(899); // safeBlock = oldest(899) - 1 = 898 → resume 899
  });

  it("honors an explicit fromBlock backfill request", async () => {
    mockProvider.getBlockNumber.mockResolvedValue(248000050);
    const result = await sync.runSync({ fromBlock: 248000000 });
    expect(result.scannedFrom).toBe(248000000);
    expect(result.reorgDepth).toBe(0);
  });

  it("returns 'already up to date' when startBlock is past the head", async () => {
    mockProvider.getBlockNumber.mockResolvedValue(100); // below the 248M default start
    const result = await sync.runSync();
    expect(result.message).toBe("Already up to date");
  });

  it("scans rebate logs when VAULT_CORE_ADDRESS is configured", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    mockProvider.getBlockNumber.mockResolvedValue(248000010);
    const rebateTopic = (jest.requireActual("ethers") as any).ethers.id("RebateAccrued(address,uint256)");
    const referrerTopic = "0x" + "0".repeat(24) + "abcdef0000000000000000000000000000000001";
    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (Array.isArray(filter.topics?.[0]) === false && filter.topics?.[0] === rebateTopic) {
        return Promise.resolve([
          {
            topics: [rebateTopic, referrerTopic],
            data: "0x" + (10n ** 6n).toString(16).padStart(64, "0"),
            blockNumber: 248000005,
            transactionHash: "0x" + "1".repeat(64),
            index: 0,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    const result = await sync.runSync();
    expect(result.success).toBe(true);
  });

  it("handles a rebate getLogs rejection gracefully", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    mockProvider.getBlockNumber.mockResolvedValue(248000010);
    const rebateTopic = (jest.requireActual("ethers") as any).ethers.id("RebateAccrued(address,uint256)");
    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.topics?.[0] === rebateTopic) return Promise.reject(new Error("rebate scan failed"));
      return Promise.resolve([]);
    });
    const result = await sync.runSync();
    expect(result.success).toBe(true);
  });

  it("shrinks the chunk and eventually stops when getLogs keeps failing", async () => {
    process.env.INDEXER_MAX_CHUNK = "4000";
    process.env.INDEXER_MIN_CHUNK = "1000";
    jest.resetModules();
    // Re-register pg mock so the freshly imported sync.js still gets mockPool.
    jest.doMock("pg", () => ({
      __esModule: true,
      Pool: jest.fn(() => mockPool),
      default: { Pool: jest.fn(() => mockPool) },
    }));
    const fresh = await import("../routes/sync.js");
    mockProvider.getBlockNumber.mockResolvedValue(248010000);
    mockProvider.getLogs.mockRejectedValue(new Error("range too large"));
    mockPool.query.mockResolvedValue({ rows: [] });
    const result = await fresh.runSync();
    expect(result.success).toBe(true);
    expect(mockProvider.getLogs).toHaveBeenCalled();
  });

  describe("advisory lock (non-test env)", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("skips when another pulse holds the lock", async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
      const result = await sync.runSync();
      expect(result.skipped).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("acquires the lock, runs, and releases", async () => {
      mockClient.query.mockResolvedValue({ rows: [{ locked: true }] });
      mockProvider.getBlockNumber.mockResolvedValue(100); // up-to-date fast path
      const result = await sync.runSync();
      expect(result.success).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("propagates a lock-acquisition error after releasing the client", async () => {
      mockClient.query.mockRejectedValueOnce(new Error("lock query failed"));
      await expect(sync.runSync()).rejects.toThrow("lock query failed");
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe("GET / route", () => {
    let app: Express;
    beforeEach(async () => {
      const express = (await import("express")).default;
      app = express();
      app.use("/api/sync", sync.default);
    });

    it("rejects unauthorized cron requests when CRON_SECRET is set", async () => {
      process.env.CRON_SECRET = "topsecret";
      const res = await request(app).get("/api/sync");
      expect(res.status).toBe(401);
    });

    it("allows a forced sync via key=force", async () => {
      process.env.CRON_SECRET = "topsecret";
      mockProvider.getBlockNumber.mockResolvedValue(100);
      const res = await request(app).get("/api/sync?key=force");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 500 when the sync throws", async () => {
      delete process.env.TRADING_CORE_ADDRESS;
      delete process.env.DEPLOYED_TRADING_CORE;
      const res = await request(app).get("/api/sync");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe("checkAndSync + repair", () => {
    it("runs a catch-up pulse and repairs missing block times when stale", async () => {
      mockProvider.getBlockNumber.mockResolvedValue(100); // sync fast path
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT last_synced_at")) {
          return Promise.resolve({ rows: [{ last_synced_at: new Date(Date.now() - 120_000).toISOString() }] });
        }
        if (sql.includes("block_time IS NULL")) {
          return Promise.resolve({ rows: [{ id: 1, block_number: 50 }] });
        }
        return Promise.resolve({ rows: [] });
      });
      await expect(sync.checkAndSync()).resolves.toBeUndefined();
    });

    it("skips the pulse when the last sync is recent", async () => {
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT last_synced_at")) {
          return Promise.resolve({ rows: [{ last_synced_at: new Date().toISOString() }] });
        }
        return Promise.resolve({ rows: [] });
      });
      await expect(sync.checkAndSync()).resolves.toBeUndefined();
    });

    it("runs an initial pulse when there is no prior sync timestamp", async () => {
      mockProvider.getBlockNumber.mockResolvedValue(100);
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT last_synced_at")) return Promise.resolve({ rows: [] }); // no prior sync
        return Promise.resolve({ rows: [] });
      });
      await expect(sync.checkAndSync()).resolves.toBeUndefined();
    });

    it("logs and swallows when the staleness check query throws", async () => {
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT last_synced_at")) return Promise.reject(new Error("check failed"));
        return Promise.resolve({ rows: [] });
      });
      await expect(sync.checkAndSync()).resolves.toBeUndefined();
    });
  });
});
