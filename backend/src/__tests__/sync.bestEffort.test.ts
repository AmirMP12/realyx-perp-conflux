import { jest } from "@jest/globals";

/**
 * Tests runSync's best-effort error paths that the happy-path scenarios
 * never reach:
 *  - reorg-window purge failure (DELETE position_events rejects)
 *  - checkpoint persist failure (block_checkpoints INSERT rejects)
 *  - rebate / bad-debt processing catch blocks + the block-time reuse path
 *
 * These are all "log-and-continue" paths: the pulse must never throw, so we
 * assert it resolves while the corresponding console handler fires.
 */

const mockPool = {
  query: jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(),
  on: jest.fn(),
  connect: jest.fn(),
};

jest.mock("pg", () => ({
  __esModule: true,
  Pool: jest.fn(() => mockPool),
  default: { Pool: jest.fn(() => mockPool) },
}));

const realEthers = jest.requireActual("ethers") as any;

const REBATE_TOPIC = realEthers.ethers.id("RebateAccrued(address,uint256)");
const BAD_DEBT_TOPIC = realEthers.ethers.id("BadDebtCovered(uint256,uint256,uint256)");

const mockProvider = {
  getBlockNumber: jest.fn<() => Promise<number>>().mockResolvedValue(1000),
  getLogs: jest.fn<(filter: any) => Promise<any[]>>().mockResolvedValue([]),
  getBlock: jest.fn<(bn: number) => Promise<any>>().mockResolvedValue({ hash: "0x" + "a".repeat(64), timestamp: 1713400000 }),
  getNetwork: jest.fn().mockResolvedValue({ chainId: 71 }),
};

// Each `new ethers.Interface(abi)` returns a fresh stub with its own parseLog,
// captured in creation order: [tradingCore, rebate, badDebt].
const ifaceInstances: Array<{ parseLog: jest.Mock }> = [];

jest.mock("ethers", () => {
  const original = jest.requireActual("ethers") as any;
  const InterfaceMock = jest.fn().mockImplementation(() => {
    const inst = {
      // Default parse result is shaped to satisfy all three processors
      // (rebate: args[0]=referrer, args[1]=amount; bad-debt: args[0..2]).
      parseLog: jest.fn().mockReturnValue({
        args: ["0xReferrer0000000000000000000000000000000001", 1500000n, 2n],
      }),
    };
    ifaceInstances.push(inst);
    return inst;
  });
  return {
    ...original,
    ethers: {
      ...original.ethers,
      JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
      Interface: InterfaceMock,
      id: original.ethers.id,
    },
    JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
    Interface: InterfaceMock,
  };
});

/** Route getLogs by topic: trading-core (array topic), rebate, or bad-debt. */
function routeGetLogs(rebateLogs: any[], badDebtLogs: any[]) {
  mockProvider.getLogs.mockImplementation((filter: any) => {
    const top = filter?.topics?.[0];
    if (Array.isArray(top)) return Promise.resolve([]); // trading-core scan
    if (top === REBATE_TOPIC) return Promise.resolve(rebateLogs);
    if (top === BAD_DEBT_TOPIC) return Promise.resolve(badDebtLogs);
    return Promise.resolve([]);
  });
}

const VAULT = "0x98E011A8782aF36C5Ad6051bC54B86a7c0705F67";
const TRADING = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";

describe("runSync best-effort behavior", () => {
  let sync: typeof import("../routes/sync.js");

  beforeEach(async () => {
    jest.clearAllMocks();
    ifaceInstances.length = 0;
    process.env.POSTGRES_URL = "postgres://local";
    process.env.TRADING_CORE_ADDRESS = TRADING;
    process.env.NODE_ENV = "test";
    mockProvider.getBlockNumber.mockResolvedValue(1000);
    mockProvider.getLogs.mockResolvedValue([]);
    mockProvider.getBlock.mockResolvedValue({ hash: "0x" + "a".repeat(64), timestamp: 1713400000 });
    sync = await import("../routes/sync.js");
  });

  afterEach(() => {
    delete process.env.VAULT_CORE_ADDRESS;
  });

  it("logs and continues when the reorg-window purge fails", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const last = 900;
    const HASH = "0x" + "a".repeat(64);
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block FROM indexer_state")) {
        return Promise.resolve({ rows: [{ last_synced_block: last }] });
      }
      if (sql.includes("FROM block_checkpoints") && sql.includes("ORDER BY block_number DESC")) {
        return Promise.resolve({ rows: [{ block_number: last, block_hash: HASH }] });
      }
      if (sql.includes("DELETE FROM position_events")) {
        return Promise.reject(new Error("purge boom"));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockProvider.getBlock.mockResolvedValue({ number: last, hash: HASH, timestamp: 1713400000 });

    const result: any = await sync.runSync(); // resumedFromCursor → purge attempted
    expect(result.success).toBe(true);
    expect(errSpy).toHaveBeenCalledWith("[sync] reorg-window purge failed:", expect.any(Error));
    errSpy.mockRestore();
  });

  it("logs and continues when the checkpoint persist fails", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO block_checkpoints")) {
        return Promise.reject(new Error("checkpoint boom"));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    // getBlockHash returns a hash → persistBlockHash runs and rejects.
    mockProvider.getBlock.mockResolvedValue({ hash: "0x" + "c".repeat(64), timestamp: 1713400000 });

    const result: any = await sync.runSync({ fromBlock: 700 });
    expect(result.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[sync] checkpoint persist failed for"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("logs and continues when a rebate insert fails, reusing block time across same-block logs", async () => {
    process.env.VAULT_CORE_ADDRESS = VAULT;
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    // Two rebate logs at the SAME block → second reuses the cached block time.
    routeGetLogs(
      [
        { topics: [REBATE_TOPIC], data: "0x", blockNumber: 720, index: 0, transactionHash: "0xR1" },
        { topics: [REBATE_TOPIC], data: "0x", blockNumber: 720, index: 1, transactionHash: "0xR2" },
      ],
      [],
    );
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO referral_rebates")) {
        return Promise.reject(new Error("rebate insert boom"));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result: any = await sync.runSync({ fromBlock: 700 });
    // rebate iface is the 2nd Interface constructed; its default parse result
    // is set in the factory above.

    expect(result.success).toBe(true);
    expect(errSpy).toHaveBeenCalledWith("Rebate parse error", expect.any(Error));
    errSpy.mockRestore();
  });

  it("logs and continues when a bad-debt insert fails, reusing block time across same-block logs", async () => {
    process.env.VAULT_CORE_ADDRESS = VAULT;
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    routeGetLogs(
      [],
      [
        { topics: [BAD_DEBT_TOPIC], data: "0x", blockNumber: 730, index: 0, transactionHash: "0xB1" },
        { topics: [BAD_DEBT_TOPIC], data: "0x", blockNumber: 730, index: 1, transactionHash: "0xB2" },
      ],
    );
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO bad_debt_claims")) {
        return Promise.reject(new Error("bad-debt insert boom"));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result: any = await sync.runSync({ fromBlock: 700 });
    expect(result.success).toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
