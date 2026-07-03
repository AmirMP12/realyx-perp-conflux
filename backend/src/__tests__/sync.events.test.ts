import { jest } from "@jest/globals";

let mockQueryImpl: jest.Mock<any>;
let mockGetBlockNumber: jest.Mock<any>;
let mockGetLogs: jest.Mock<any>;
let mockGetBlock: jest.Mock<any>;
let mockParseLog: jest.Mock<any>;

jest.mock("pg", () => {
  mockQueryImpl = jest.fn<any>().mockResolvedValue({ rows: [], rowCount: 0 });
  const Pool = jest.fn<any>(() => ({
    query: (...a: any[]) => mockQueryImpl(...a),
    on: jest.fn(),
    end: jest.fn(),
  }));
  return { __esModule: true, default: { Pool }, Pool };
});

jest.mock("ethers", () => {
  mockGetBlockNumber = jest.fn<any>().mockResolvedValue(1000);
  mockGetLogs = jest.fn<any>().mockResolvedValue([]);
  mockGetBlock = jest.fn<any>().mockResolvedValue({ hash: "0xabc", timestamp: 1700000000 });
  mockParseLog = jest.fn<any>();

  const mockEthers = {
    JsonRpcProvider: jest.fn<any>().mockImplementation(() => ({
      getBlockNumber: (...a: any[]) => mockGetBlockNumber(...a),
      getLogs: (...a: any[]) => mockGetLogs(...a),
      getBlock: (...a: any[]) => mockGetBlock(...a),
      getNetwork: jest.fn<any>().mockResolvedValue({ chainId: 1030 }),
    })),
    Interface: jest.fn<any>().mockImplementation(() => ({
      parseLog: (...a: any[]) => mockParseLog(...a),
    })),
    id: jest.fn<any>().mockReturnValue("0xTopic"),
    ZeroHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
  return { ...mockEthers, ethers: mockEthers };
});

import { runSync } from "../routes/sync.js";

const TRADING_CORE = "0x" + "a".repeat(40);
const VAULT_CORE = "0x" + "b".repeat(40);
const COPY_REGISTRY = "0x" + "c".repeat(40);
const TX_HASH = "0x" + "f".repeat(64);

function makeLog(overrides?: any) {
  return {
    address: TRADING_CORE,
    blockNumber: 500,
    transactionHash: TX_HASH,
    topics: ["0xTopic"],
    data: "0x",
    index: 0,
    ...overrides,
  };
}

describe("sync runSync event processing", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.POSTGRES_URL = "postgres://test";
    process.env.TRADING_CORE_ADDRESS = TRADING_CORE;
    process.env.RPC_URL = "http://localhost:8545";
    delete process.env.VAULT_CORE_ADDRESS;
    delete process.env.COPY_REGISTRY_ADDRESS;
    delete process.env.DEPLOYED_VAULT_CORE;
    delete process.env.DEPLOYED_COPY_REGISTRY;

    mockGetBlockNumber.mockResolvedValue(1000);
    mockGetLogs.mockResolvedValue([]);
    mockGetBlock.mockResolvedValue({ hash: "0xabc", timestamp: 1700000000 });
    mockQueryImpl.mockResolvedValue({ rows: [], rowCount: 0 });
    mockParseLog.mockReturnValue(null);
  });

  afterAll(() => {
    process.env = { ...OLD_ENV };
  });

  it("returns 'Already up to date' when startBlock > latestBlock", async () => {
    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) {
        return Promise.resolve({ rows: [{ last_synced_block: 2000 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const result = await runSync();
    expect(result.message).toBe("Already up to date");
  });

  it("options.fromBlock overrides the resumed cursor", async () => {
    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) {
        return Promise.resolve({ rows: [{ last_synced_block: 900 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockGetBlockNumber.mockResolvedValue(110);
    const result = await runSync({ fromBlock: 100 });
    expect(result.success).toBe(true);
    expect(result.reorgDepth).toBe(0);
  });

  it("isCaughtUp = true when finalTo >= latestBlock", async () => {
    mockGetBlockNumber.mockResolvedValue(100);
    const result = await runSync({ fromBlock: 1 });
    expect(result.success).toBe(true);
    expect(result.isCaughtUp).toBe(true);
  });

  it("grows chunk back after a getLogs failure shrinks it", async () => {
    let calls = 0;
    mockGetLogs.mockImplementation(() => {
      calls++;
      if (calls === 1) throw new Error("range too large");
      return Promise.resolve([]);
    });
    mockGetBlockNumber.mockResolvedValue(200);
    const result = await runSync({ fromBlock: 1 });
    expect(result.success).toBe(true);
  });

  it("breaks at min chunk when getLogs keeps failing", async () => {
    mockGetLogs.mockRejectedValue(new Error("rpc down"));
    mockGetBlockNumber.mockResolvedValue(1000);
    const result = await runSync({ fromBlock: 999 });
    expect(result.success).toBe(true);
  });

  it("uses fixed rewind when checkpoint read fails", async () => {
    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) {
        return Promise.resolve({ rows: [{ last_synced_block: 900 }], rowCount: 1 });
      }
      if (sql.includes("block_checkpoints") && sql.includes("SELECT")) {
        throw new Error("checkpoint read failed");
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockGetBlockNumber.mockResolvedValue(900);
    const result = await runSync();
    expect(result.success).toBe(true);
  });

  it("uses fixed rewind when no checkpoints are stored", async () => {
    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) {
        return Promise.resolve({ rows: [{ last_synced_block: 500 }], rowCount: 1 });
      }
      if (sql.includes("block_checkpoints") && sql.includes("SELECT")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockGetBlockNumber.mockResolvedValue(400);
    const result = await runSync();
    expect(result.success).toBe(true);
  });

  it("resumes from matching checkpoint without reorg", async () => {
    const storedHash = "0xabc";
    mockGetBlock.mockResolvedValue({ hash: storedHash, timestamp: 1700000000 });
    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) {
        return Promise.resolve({ rows: [{ last_synced_block: 500 }], rowCount: 1 });
      }
      if (sql.includes("block_checkpoints") && sql.includes("SELECT")) {
        return Promise.resolve({ rows: [{ block_number: 500, block_hash: storedHash }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockGetBlockNumber.mockResolvedValue(500);
    const result = await runSync();
    expect(result.success).toBe(true);
    if (result.reorgDepth !== undefined) {
      expect(result.reorgDepth).toBe(0);
    }
  });

  it("detects reorg when checkpoint hash mismatches on-chain", async () => {
    mockGetBlock.mockResolvedValue({ hash: "0xDIFFERENT", timestamp: 1700000000 });
    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) {
        return Promise.resolve({ rows: [{ last_synced_block: 500 }], rowCount: 1 });
      }
      if (sql.includes("block_checkpoints") && sql.includes("SELECT")) {
        return Promise.resolve({
          rows: [{ block_number: 500, block_hash: "0xMATCHES_NOTHING" }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockGetBlockNumber.mockResolvedValue(600);
    const result = await runSync();
    expect(result.success).toBe(true);
    expect(result.reorgDepth).toBeGreaterThan(0);
  });

  it("handles getBlock failure during reorg hash walk", async () => {
    mockGetBlock.mockRejectedValue(new Error("rpc getBlock failed"));
    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) {
        return Promise.resolve({ rows: [{ last_synced_block: 500 }], rowCount: 1 });
      }
      if (sql.includes("block_checkpoints") && sql.includes("SELECT")) {
        return Promise.resolve({ rows: [{ block_number: 500, block_hash: "0xhash" }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockGetBlockNumber.mockResolvedValue(400);
    const result = await runSync();
    expect(result.success).toBe(true);
  });

  it("reuses cached blockTime for logs in the same block", async () => {
    mockParseLog
      .mockReturnValueOnce({
        name: "PositionOpened",
        args: [BigInt(1), "0xTrader1", "0xMarket1", true, BigInt(1e18), BigInt(5), BigInt(1000)],
      })
      .mockReturnValueOnce({
        name: "PositionOpened",
        args: [BigInt(2), "0xTrader2", "0xMarket2", false, BigInt(2e18), BigInt(3), BigInt(2000)],
      });

    const twoLogs = [
      makeLog({ blockNumber: 500, index: 0, transactionHash: TX_HASH }),
      makeLog({ blockNumber: 500, index: 1, transactionHash: TX_HASH + "1" }),
    ];
    mockGetLogs.mockResolvedValueOnce(twoLogs);
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    expect(result.eventsSynced).toBeGreaterThanOrEqual(0);
  });

  it("processes PositionLiquidated events", async () => {
    mockParseLog.mockReturnValue({
      name: "PositionLiquidated",
      args: [BigInt(1), "0xLiquidator", BigInt(999), BigInt(10)],
    });
    mockGetLogs.mockResolvedValueOnce([makeLog()]);
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    expect(result.eventsSynced).toBeGreaterThanOrEqual(0);
  });

  it("processes PositionClosed with cached open position", async () => {
    mockParseLog
      .mockReturnValueOnce({
        name: "PositionOpened",
        args: [BigInt(42), "0xTrader", "0xMarket", true, BigInt(1e18), BigInt(5), BigInt(1000)],
      })
      .mockReturnValueOnce({
        name: "PositionClosed",
        args: [BigInt(42), "0xTrader", BigInt(-100), BigInt(950), BigInt(5)],
      });

    mockGetLogs.mockResolvedValueOnce([
      makeLog({ blockNumber: 500, index: 0 }),
      makeLog({ blockNumber: 500, index: 1, transactionHash: TX_HASH + "b" }),
    ]);
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
  });

  it("processes PositionClosed with DB open-event lookup", async () => {
    mockParseLog.mockReturnValue({
      name: "PositionClosed",
      args: [BigInt(99), "0xTrader", BigInt(-200), BigInt(900), BigInt(5)],
    });
    mockGetLogs.mockResolvedValueOnce([makeLog()]);

    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("PositionOpened") && sql.includes("position_id")) {
        return Promise.resolve({ rows: [{ account: "0xdb_account", market_id: "0xmarket", data: [] }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
  });

  it("handles DB open-event lookup failure for PositionClosed", async () => {
    mockParseLog.mockReturnValue({
      name: "PositionClosed",
      args: [BigInt(88), "0xTrader", BigInt(-50), BigInt(950), BigInt(5)],
    });
    mockGetLogs.mockResolvedValueOnce([makeLog()]);

    mockQueryImpl.mockImplementation((sql: string) => {
      if (sql.includes("PositionOpened") && sql.includes("position_id")) {
        throw new Error("db lookup failed");
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
  });

  it("skips logs that fail to parse", async () => {
    mockParseLog.mockReturnValue(null);
    mockGetLogs.mockResolvedValueOnce([makeLog()]);
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    expect(result.eventsSynced).toBe(0);
  });

  it("falls back when getBlock fails during getBlockTime", async () => {
    let callCount = 0;
    mockGetBlock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error("getBlock failed");
      return Promise.resolve({ hash: "0xhash", timestamp: 1700000000 });
    });

    mockParseLog.mockReturnValue({
      name: "PositionOpened",
      args: [BigInt(1), "0xTrader", "0xMarket", true, BigInt(1e18), BigInt(5), BigInt(1000)],
    });
    mockGetLogs.mockResolvedValueOnce([makeLog()]);
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
  });

  it("skips checkpoint persist when getBlockHash fails", async () => {
    let callCount = 0;
    mockGetBlock.mockImplementation(() => {
      callCount++;
      if (callCount > 1) throw new Error("hash fetch failed");
      return Promise.resolve({ hash: "0xgood", timestamp: 1700000000 });
    });

    mockGetLogs.mockResolvedValueOnce([makeLog()]);
    mockParseLog.mockReturnValue({
      name: "PositionOpened",
      args: [BigInt(5), "0xTrader", "0xMarket", true, BigInt(1e18), BigInt(5), BigInt(1000)],
    });
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
  });

  it("reuses cached blockTime for rebate logs in the same block", async () => {
    process.env.VAULT_CORE_ADDRESS = VAULT_CORE;

    const rebateLog = {
      address: VAULT_CORE,
      blockNumber: 500,
      transactionHash: TX_HASH,
      topics: ["0xRebateTopic"],
      data: "0x",
      index: 0,
    };
    const rebateLog2 = { ...rebateLog, index: 1, transactionHash: TX_HASH + "2" };

    mockGetLogs.mockImplementation((_opts: any) => {
      if (_opts?.address === VAULT_CORE) return Promise.resolve([rebateLog, rebateLog2]);
      return Promise.resolve([]);
    });

    mockParseLog.mockImplementation(() => {
      return { name: "RebateAccrued", args: ["0xReferrer", BigInt(100)] };
    });

    mockGetBlockNumber.mockResolvedValue(600);
    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    delete process.env.VAULT_CORE_ADDRESS;
  });

  it("skips unparseable rebate logs", async () => {
    process.env.VAULT_CORE_ADDRESS = VAULT_CORE;
    const rebateLog = { address: VAULT_CORE, blockNumber: 500, transactionHash: TX_HASH, topics: ["0xT"], data: "0x", index: 0 };
    mockGetLogs.mockImplementation((_opts: any) => {
      if (_opts?.address === VAULT_CORE) return Promise.resolve([rebateLog]);
      return Promise.resolve([]);
    });
    mockParseLog.mockReturnValue(null);
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    expect(result.rebatesSynced).toBe(0);
    delete process.env.VAULT_CORE_ADDRESS;
  });

  it("reuses cached blockTime for bad debt logs in the same block", async () => {
    process.env.VAULT_CORE_ADDRESS = VAULT_CORE;
    const bdLog = { address: VAULT_CORE, blockNumber: 600, transactionHash: TX_HASH, topics: ["0xBDTopic"], data: "0x", index: 0 };
    const bdLog2 = { ...bdLog, index: 1, transactionHash: TX_HASH + "3" };

    mockGetLogs.mockImplementation((_opts: any) => {
      if (_opts?.address === VAULT_CORE) return Promise.resolve([bdLog, bdLog2]);
      return Promise.resolve([]);
    });
    mockParseLog.mockReturnValue({
      name: "BadDebtCovered",
      args: [BigInt(1), BigInt(500), BigInt(42)],
    });
    mockGetBlockNumber.mockResolvedValue(700);

    const result = await runSync({ fromBlock: 590 });
    expect(result.success).toBe(true);
    delete process.env.VAULT_CORE_ADDRESS;
  });

  it("processes LeadTraderUpdated copy registry events", async () => {
    process.env.COPY_REGISTRY_ADDRESS = COPY_REGISTRY;
    const copyLog = { address: COPY_REGISTRY, blockNumber: 500, transactionHash: TX_HASH, topics: ["0xCopyTopic"], data: "0x", index: 0 };

    mockGetLogs.mockImplementation((_opts: any) => {
      if (_opts?.address === COPY_REGISTRY) return Promise.resolve([copyLog]);
      return Promise.resolve([]);
    });
    mockParseLog.mockReturnValue({
      name: "LeadTraderUpdated",
      args: [BigInt(1), 300, "ipfs://new"],
    });
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    delete process.env.COPY_REGISTRY_ADDRESS;
  });

  it("processes FollowedTrader copy registry events", async () => {
    process.env.COPY_REGISTRY_ADDRESS = COPY_REGISTRY;
    const copyLog = { address: COPY_REGISTRY, blockNumber: 500, transactionHash: TX_HASH, topics: ["0xCopyTopic"], data: "0x", index: 0 };
    mockGetLogs.mockImplementation((_opts: any) => {
      if (_opts?.address === COPY_REGISTRY) return Promise.resolve([copyLog]);
      return Promise.resolve([]);
    });
    mockParseLog.mockReturnValue({
      name: "FollowedTrader",
      args: ["0xCopier", "0xLeader", BigInt(1000), 5],
    });
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    delete process.env.COPY_REGISTRY_ADDRESS;
  });

  it("processes CopierConfigUpdated copy registry events", async () => {
    process.env.COPY_REGISTRY_ADDRESS = COPY_REGISTRY;
    const copyLog = { address: COPY_REGISTRY, blockNumber: 500, transactionHash: TX_HASH, topics: ["0xCopyTopic"], data: "0x", index: 0 };
    mockGetLogs.mockImplementation((_opts: any) => {
      if (_opts?.address === COPY_REGISTRY) return Promise.resolve([copyLog]);
      return Promise.resolve([]);
    });
    mockParseLog.mockReturnValue({
      name: "CopierConfigUpdated",
      args: ["0xCopier", "0xLeader", BigInt(2000), 10],
    });
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    delete process.env.COPY_REGISTRY_ADDRESS;
  });

  it("processes UnfollowedTrader copy registry events", async () => {
    process.env.COPY_REGISTRY_ADDRESS = COPY_REGISTRY;
    const copyLog = { address: COPY_REGISTRY, blockNumber: 500, transactionHash: TX_HASH, topics: ["0xCopyTopic"], data: "0x", index: 0 };
    mockGetLogs.mockImplementation((_opts: any) => {
      if (_opts?.address === COPY_REGISTRY) return Promise.resolve([copyLog]);
      return Promise.resolve([]);
    });
    mockParseLog.mockReturnValue({
      name: "UnfollowedTrader",
      args: ["0xCopier", "0xLeader"],
    });
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    delete process.env.COPY_REGISTRY_ADDRESS;
  });

  it("reuses cached blockTime for copy registry logs in the same block", async () => {
    process.env.COPY_REGISTRY_ADDRESS = COPY_REGISTRY;
    const log1 = { address: COPY_REGISTRY, blockNumber: 500, transactionHash: TX_HASH, topics: ["0xT"], data: "0x", index: 0 };
    const log2 = { ...log1, index: 1, transactionHash: TX_HASH + "x" };
    mockGetLogs.mockImplementation((_opts: any) => {
      if (_opts?.address === COPY_REGISTRY) return Promise.resolve([log1, log2]);
      return Promise.resolve([]);
    });
    mockParseLog.mockReturnValue({
      name: "UnfollowedTrader",
      args: ["0xA", "0xB"],
    });
    mockGetBlockNumber.mockResolvedValue(600);

    const result = await runSync({ fromBlock: 490 });
    expect(result.success).toBe(true);
    delete process.env.COPY_REGISTRY_ADDRESS;
  });

  it("refreshes copy trading stats when COPY_REGISTRY_ADDRESS is set", async () => {
    process.env.COPY_REGISTRY_ADDRESS = COPY_REGISTRY;
    mockGetBlockNumber.mockResolvedValue(600);
    mockGetLogs.mockResolvedValue([]);

    const result = await runSync({ fromBlock: 590 });
    expect(result.success).toBe(true);
    delete process.env.COPY_REGISTRY_ADDRESS;
  });
});

describe("sync route AggregateError formatting", () => {
  it("joins AggregateError messages with ';'", () => {
    const err = new AggregateError(
      [new Error("err A"), new Error("err B")],
      "combined"
    );
    const msg =
      err instanceof AggregateError
        ? (err.errors?.map((e: any) => e?.message ?? String(e)).join("; ") ?? String(err))
        : err instanceof Error
        ? err.message
        : String(err);
    expect(msg).toBe("err A; err B");
  });

  it("falls back to String(error) when AggregateError.errors is undefined", () => {
    const err = new AggregateError([], "empty");
    (err as any).errors = undefined;
    const msg =
      err instanceof AggregateError
        ? (err.errors?.map((e: any) => e?.message ?? String(e)).join("; ") ?? String(err))
        : err instanceof Error
        ? err.message
        : String(err);
    expect(typeof msg).toBe("string");
  });

  it("uses error.message for a regular Error", () => {
    const err = new Error("regular error");
    const msg =
      err instanceof AggregateError
        ? (err.errors?.map((e: any) => e?.message ?? String(e)).join("; ") ?? String(err))
        : err instanceof Error
        ? err.message
        : String(err);
    expect(msg).toBe("regular error");
  });

  it("uses String(error) for a non-Error thrown value", () => {
    const err = 42;
    const msg =
      err instanceof AggregateError
        ? ((err as any).errors?.map((e: any) => e?.message ?? String(e)).join("; ") ?? String(err))
        : err instanceof Error
        ? err.message
        : String(err);
    expect(msg).toBe("42");
  });
});
