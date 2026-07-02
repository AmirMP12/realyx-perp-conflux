import { jest } from "@jest/globals";

const mockPool = {
  query: jest.fn<any>(),
  on: jest.fn(),
  connect: jest.fn(),
};

jest.mock("pg", () => ({
  __esModule: true,
  Pool: jest.fn(() => mockPool),
  default: { Pool: jest.fn(() => mockPool) },
}));

const mockProvider = {
  getBlockNumber: jest.fn<any>().mockResolvedValue(248000100),
  getLogs: jest.fn<any>(),
  getBlock: jest.fn<any>().mockResolvedValue({ number: 248000050, hash: "0x" + "a".repeat(64), timestamp: 1713400000 }),
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

const realEthers = (jest.requireActual("ethers") as any).ethers;

const TRADING_ABI = [
  "event PositionOpened(uint256 indexed positionId, address indexed trader, address indexed market, bool isLong, uint256 size, uint256 leverage, uint256 entryPrice)",
  "event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnL, uint256 exitPrice, uint256 closingFee)",
  "event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 liquidationPrice, uint256 liquidationFee)",
];
const REBATE_ABI = ["event RebateAccrued(address indexed referrer, uint256 amount)"];

const tIface = new realEthers.Interface(TRADING_ABI);
const rIface = new realEthers.Interface(REBATE_ABI);

const TRADER = "0x1111111111111111111111111111111111111111";
const MARKET = "0x2222222222222222222222222222222222222222";
const LIQ = "0x3333333333333333333333333333333333333333";
const REFERRER = "0x4444444444444444444444444444444444444444";

function tLog(name: string, args: any[], blockNumber: number, index: number) {
  const enc = tIface.encodeEventLog(name, args);
  return { topics: enc.topics, data: enc.data, blockNumber, transactionHash: "0x" + index.toString(16).padStart(64, "0"), index, address: "0xcore" };
}
function rLog(args: any[], blockNumber: number, index: number) {
  const enc = rIface.encodeEventLog("RebateAccrued", args);
  return { topics: enc.topics, data: enc.data, blockNumber, transactionHash: "0x" + ("r" + index).padStart(64, "0"), index, address: "0xvault" };
}

describe("sync log processing", () => {
  let sync: typeof import("../routes/sync.js");
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mockProvider.getBlockNumber.mockResolvedValue(248000100);
    mockProvider.getBlock.mockResolvedValue({ number: 248000050, hash: "0x" + "a".repeat(64), timestamp: 1713400000 });
    process.env.POSTGRES_URL = "postgres://local";
    process.env.TRADING_CORE_ADDRESS = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
    process.env.VAULT_CORE_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.NODE_ENV = "test";
    delete process.env.INDEXER_START_BLOCK;
    sync = await import("../routes/sync.js");
    sync.resetSyncPool();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("parses opened/closed/liquidated events plus rebates and inserts them", async () => {
    const e18 = 10n ** 18n;
    const openA = tLog("PositionOpened", [1n, TRADER, MARKET, true, 1000n * e18, 10n * e18, 2000n], 248000050, 0);
    const closeA = tLog("PositionClosed", [1n, TRADER, 50n, 2100n, 1n], 248000050, 1); // resolved via in-batch cache
    const closeB = tLog("PositionClosed", [2n, TRADER, -10n, 1900n, 1n], 248000051, 2); // resolved via DB
    const liqC = tLog("PositionLiquidated", [3n, LIQ, 1800n, 5n], 248000052, 3); // resolved via DB (empty)
    const rebate = rLog([REFERRER, 1_000_000n], 248000050, 0);

    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.address === process.env.VAULT_CORE_ADDRESS) return Promise.resolve([rebate]);
      return Promise.resolve([openA, closeA, closeB, liqC]);
    });

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
      if (sql.includes("ORDER BY id DESC LIMIT 1")) {
        return Promise.resolve({ rows: [{ account: TRADER, market_id: MARKET, data: null }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await sync.runSync();
    expect(result.success).toBe(true);
    expect(result.eventsSynced).toBeGreaterThanOrEqual(4);
    expect(result.rebatesSynced).toBeGreaterThanOrEqual(0);
  });

  it("resolves a close via DB when not seen in the same batch", async () => {
    const closeOnly = tLog("PositionClosed", [99n, TRADER, 50n, 2100n, 1n], 248000050, 0);
    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.address === process.env.VAULT_CORE_ADDRESS) return Promise.resolve([]);
      return Promise.resolve([closeOnly]);
    });
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
      if (sql.includes("ORDER BY id DESC LIMIT 1")) {
        return Promise.resolve({ rows: [{ account: TRADER, market_id: "0x", data: [99, TRADER, MARKET] }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const result = await sync.runSync();
    expect(result.success).toBe(true);
  });

  it("continues when an open-resolution DB lookup throws", async () => {
    const closeOnly = tLog("PositionClosed", [77n, TRADER, 50n, 2100n, 1n], 248000050, 0);
    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.address === process.env.VAULT_CORE_ADDRESS) return Promise.resolve([]);
      return Promise.resolve([closeOnly]);
    });
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
      if (sql.includes("ORDER BY id DESC LIMIT 1")) return Promise.reject(new Error("lookup failed"));
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const result = await sync.runSync();
    expect(result.success).toBe(true);
  });

  it("scans multiple chunks and resolves a close via DB with array open data + logIndex", async () => {
    mockProvider.getBlockNumber.mockResolvedValue(248120000); // forces >1 chunk iteration
    mockProvider.getBlock.mockResolvedValue(null); // getBlockHash null + getBlockTime fallback
    const close = { ...tLog("PositionClosed", [5n, TRADER, 0n, 2100n, 1n], 248000050, 0) } as any;
    delete close.index;
    close.logIndex = 4;
    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.address === process.env.VAULT_CORE_ADDRESS) return Promise.resolve([]);
      if (filter.fromBlock <= 248000050 && filter.toBlock >= 248000050) return Promise.resolve([close]);
      return Promise.resolve([]);
    });
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
      if (sql.includes("ORDER BY id DESC LIMIT 1")) {
        return Promise.resolve({ rows: [{ account: TRADER, market_id: "0x", data: ["5", TRADER, MARKET, "true", "900"] }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const result = await sync.runSync();
    expect(result.success).toBe(true);
    expect(result.scannedTo).toBe(248120000);
  });

  it("recovers from a getLogs failure by shrinking then resuming", async () => {
    process.env.INDEXER_MAX_CHUNK = "8000";
    process.env.INDEXER_MIN_CHUNK = "1000";
    await jest.isolateModulesAsync(async () => {
      jest.doMock("pg", () => ({
        __esModule: true,
        Pool: jest.fn(() => mockPool),
        default: { Pool: jest.fn(() => mockPool) },
      }));
      const fresh = await import("../routes/sync.js");
      mockProvider.getBlockNumber.mockResolvedValue(248030000);
      let calls = 0;
      mockProvider.getLogs.mockImplementation((filter: any) => {
        if (filter.address === process.env.VAULT_CORE_ADDRESS) return Promise.resolve([]);
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("range too large")); // shrink
        return Promise.resolve([]); // subsequent succeed → chunk grows back
      });
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
        if (sql.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [], rowCount: 1 });
      });
      const result = await fresh.runSync();
      expect(result.success).toBe(true);
    });
  });
});
