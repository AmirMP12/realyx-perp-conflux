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

const COPY_ABI = [
  "event LeadTraderRegistered(uint256 indexed leadTraderId, address indexed trader, uint16 profitFeeBps, string metadataURI)",
  "event LeadTraderUpdated(uint256 indexed leadTraderId, uint16 profitFeeBps, string metadataURI)",
  "event FollowedTrader(address indexed copier, address indexed leadTrader, uint256 maxAllocation, uint8 maxLeverage)",
  "event UnfollowedTrader(address indexed copier, address indexed leadTrader)",
  "event CopierConfigUpdated(address indexed copier, address indexed leadTrader, uint256 maxAllocation, uint8 maxLeverage)",
];
const cIface = new realEthers.Interface(COPY_ABI);

const LEAD = "0x1111111111111111111111111111111111111111";
const COPIER = "0x2222222222222222222222222222222222222222";
const COPY_REGISTRY = "0x5555555555555555555555555555555555555555";

function cLog(name: string, args: any[], blockNumber: number, index: number) {
  const enc = cIface.encodeEventLog(name, args);
  return {
    topics: enc.topics,
    data: enc.data,
    blockNumber,
    transactionHash: "0x" + index.toString(16).padStart(64, "0"),
    index,
    address: COPY_REGISTRY,
  };
}

describe("sync copy-registry processing", () => {
  let sync: typeof import("../routes/sync.js");
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockProvider.getBlockNumber.mockResolvedValue(248000100);
    mockProvider.getBlock.mockResolvedValue({ number: 248000050, hash: "0x" + "a".repeat(64), timestamp: 1713400000 });
    process.env.POSTGRES_URL = "postgres://local";
    process.env.TRADING_CORE_ADDRESS = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
    process.env.COPY_REGISTRY_ADDRESS = COPY_REGISTRY;
    process.env.NODE_ENV = "test";
    delete process.env.VAULT_CORE_ADDRESS;
    sync = await import("../routes/sync.js");
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("indexes lead-trader + follow events and refreshes stats", async () => {
    const e18 = 10n ** 18n;
    const reg = cLog("LeadTraderRegistered", [1n, LEAD, 1000, "ipfs://meta"], 248000050, 0);
    const follow = cLog("FollowedTrader", [COPIER, LEAD, 500n * e18, 5], 248000051, 1);
    const reconfigure = cLog("CopierConfigUpdated", [COPIER, LEAD, 750n * e18, 3], 248000052, 2);

    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.address === COPY_REGISTRY) return Promise.resolve([reg, follow, reconfigure]);
      return Promise.resolve([]); // trading core: no position events
    });

    const sql: string[] = [];
    mockPool.query.mockImplementation((q: string) => {
      sql.push(q);
      if (q.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
      if (q.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await sync.runSync();

    expect(result.success).toBe(true);
    expect(result.copyEventsSynced).toBe(3);
    // Lead-trader registration upsert ran.
    expect(sql.some((q) => q.includes("INSERT INTO lead_traders"))).toBe(true);
    // Follow relationship upsert ran.
    expect(sql.some((q) => q.includes("INSERT INTO copy_relationships"))).toBe(true);
    // Copier reconfigure update ran.
    expect(sql.some((q) => q.includes("UPDATE copy_relationships") && q.includes("max_allocation"))).toBe(true);
    // Stats refresh recomputed follower counts + performance.
    expect(sql.some((q) => q.includes("active_followers ="))).toBe(true);
    expect(sql.some((q) => q.includes("INSERT INTO lead_trader_stats"))).toBe(true);
  });

  it("marks a relationship inactive on UnfollowedTrader", async () => {
    const unfollow = cLog("UnfollowedTrader", [COPIER, LEAD], 248000050, 0);
    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.address === COPY_REGISTRY) return Promise.resolve([unfollow]);
      return Promise.resolve([]);
    });
    const sql: string[] = [];
    mockPool.query.mockImplementation((q: string) => {
      sql.push(q);
      if (q.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
      if (q.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await sync.runSync();
    expect(result.success).toBe(true);
    expect(result.copyEventsSynced).toBe(1);
    expect(sql.some((q) => q.includes("UPDATE copy_relationships") && q.includes("is_active = false"))).toBe(true);
  });

  it("applies LeadTraderUpdated and reuses the block time for same-block logs", async () => {
    // Two logs in the SAME block: the second reuses the cached block time
    // instead of refetching it (the lastBlock fast-path).
    const reg = cLog("LeadTraderRegistered", [1n, LEAD, 1000, "ipfs://meta"], 248000050, 0);
    const upd = cLog("LeadTraderUpdated", [1n, 1500, "ipfs://meta-v2"], 248000050, 1);
    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.address === COPY_REGISTRY) return Promise.resolve([reg, upd]);
      return Promise.resolve([]);
    });
    const sql: string[] = [];
    mockPool.query.mockImplementation((q: string) => {
      sql.push(q);
      if (q.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
      if (q.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await sync.runSync();
    expect(result.success).toBe(true);
    expect(result.copyEventsSynced).toBe(2);
    expect(sql.some((q) => q.includes("UPDATE lead_traders SET profit_fee_bps"))).toBe(true);
  });

  it("succeeds even when the copy-trading stats refresh fails", async () => {
    const reg = cLog("LeadTraderRegistered", [1n, LEAD, 1000, "ipfs://meta"], 248000050, 0);
    mockProvider.getLogs.mockImplementation((filter: any) => {
      if (filter.address === COPY_REGISTRY) return Promise.resolve([reg]);
      return Promise.resolve([]);
    });
    mockPool.query.mockImplementation((q: string) => {
      if (q.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
      if (q.includes("FROM block_checkpoints")) return Promise.resolve({ rows: [] });
      // First statement of refreshCopyTradingStats — make it blow up.
      if (q.includes("active_followers =")) return Promise.reject(new Error("stats boom"));
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await sync.runSync();
    // The raw events are already persisted, so a stats failure is swallowed
    // and the pulse still reports success.
    expect(result.success).toBe(true);
    expect(result.copyEventsSynced).toBe(1);
  });
});
