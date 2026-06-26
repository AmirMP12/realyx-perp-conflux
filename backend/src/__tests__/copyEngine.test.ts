import { jest } from "@jest/globals";

const mockQuery = jest.fn<any>();
let mockPool: any = { query: mockQuery };

jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  getPool: () => mockPool,
}));

// Capture the OrderCreated handler the engine registers.
let orderCreatedHandler: any = null;
const contractInstance = {
  on: jest.fn((_evt: string, cb: any) => { orderCreatedHandler = cb; }),
  removeAllListeners: jest.fn(),
};
const wsDestroy = jest.fn();

jest.mock("ethers", () => {
  const Contract = jest.fn(() => contractInstance);
  return {
    __esModule: true,
    Contract,
    ethers: {
      Contract,
      Wallet: jest.fn(() => ({ address: "0xbot" })),
      JsonRpcProvider: jest.fn(() => ({ kind: "http" })),
      WebSocketProvider: jest.fn(() => ({ kind: "ws", destroy: wsDestroy })),
    },
  };
});

import {
  calculateCopierSize,
  getLeadTraders,
  getActiveCopiers,
  getCopierAvailableBalance,
  CopyEngine,
  getCopyEngine,
  resetCopyEngine,
} from "../services/copyEngine.js";

describe("copyEngine", () => {
  const prevWs = process.env.WS_RPC_URL;
  const prevRpc = process.env.RPC_URL;
  const prevPk = process.env.COPY_BOT_PRIVATE_KEY;

  beforeEach(() => {
    mockQuery.mockReset();
    mockPool = { query: mockQuery };
    orderCreatedHandler = null;
    contractInstance.on.mockClear();
    contractInstance.removeAllListeners.mockClear();
    wsDestroy.mockClear();
    delete process.env.WS_RPC_URL;
    delete process.env.RPC_URL;
    delete process.env.COPY_BOT_PRIVATE_KEY;
    resetCopyEngine();
  });

  afterAll(() => {
    if (prevWs === undefined) delete process.env.WS_RPC_URL; else process.env.WS_RPC_URL = prevWs;
    if (prevRpc === undefined) delete process.env.RPC_URL; else process.env.RPC_URL = prevRpc;
    if (prevPk === undefined) delete process.env.COPY_BOT_PRIVATE_KEY; else process.env.COPY_BOT_PRIVATE_KEY = prevPk;
  });

  describe("calculateCopierSize", () => {
    it("scales the lead size proportionally to the copier's allocation", () => {
      // copierMaxAlloc6 = 100 (6dp) → 100e12 in 18dp; available is large; lead collateral 200e18.
      const leadSize = 1000n * 10n ** 18n;
      const result = calculateCopierSize(leadSize, 100n, 10n ** 30n, 200n * 10n ** 18n);
      // effectiveAlloc = 100e12; copierSize = leadSize * 100e12 / 200e18
      expect(result).toBe((leadSize * (100n * 10n ** 12n)) / (200n * 10n ** 18n));
    });

    it("caps the allocation at the available balance", () => {
      const leadSize = 1000n * 10n ** 18n;
      const available = 5n * 10n ** 12n; // smaller than maxAlloc
      const result = calculateCopierSize(leadSize, 100n, available, 200n * 10n ** 18n);
      expect(result).toBe((leadSize * available) / (200n * 10n ** 18n));
    });

    it("returns 0 when lead collateral is zero", () => {
      expect(calculateCopierSize(1000n, 100n, 10n ** 30n, 0n)).toBe(0n);
    });

    it("returns 0 when effective allocation is zero", () => {
      expect(calculateCopierSize(1000n, 0n, 0n, 200n)).toBe(0n);
    });
  });

  describe("DB helpers", () => {
    it("getLeadTraders returns [] when no pool", async () => {
      mockPool = null;
      expect(await getLeadTraders()).toEqual([]);
    });

    it("getLeadTraders returns rows", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, address: "0xA" }] });
      const rows = await getLeadTraders();
      expect(rows).toHaveLength(1);
    });

    it("getActiveCopiers returns [] when no pool", async () => {
      mockPool = null;
      expect(await getActiveCopiers("0xLEAD")).toEqual([]);
    });

    it("getActiveCopiers queries with a lowercased address", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      await getActiveCopiers("0xLEAD");
      expect(mockQuery.mock.calls[0][1]).toEqual(["0xlead"]);
    });

    it("getCopierAvailableBalance returns 0n when no pool", async () => {
      mockPool = null;
      expect(await getCopierAvailableBalance("0xC")).toBe(0n);
    });

    it("getCopierAvailableBalance returns 0n when no row", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await getCopierAvailableBalance("0xC")).toBe(0n);
    });

    it("getCopierAvailableBalance returns the free collateral", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ free_collateral: "12345" }] });
      expect(await getCopierAvailableBalance("0xC")).toBe(12345n);
    });

    it("getCopierAvailableBalance defaults a null balance to 0n", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ free_collateral: null }] });
      expect(await getCopierAvailableBalance("0xC")).toBe(0n);
    });
  });

  describe("CopyEngine lifecycle", () => {
    it("does not start without RPC_URL / COPY_BOT_PRIVATE_KEY", async () => {
      const engine = new CopyEngine("0xCore");
      await engine.start();
      expect(contractInstance.on).not.toHaveBeenCalled();
    });

    it("starts with an HTTP provider and registers the OrderCreated listener", async () => {
      process.env.RPC_URL = "https://rpc.example";
      process.env.COPY_BOT_PRIVATE_KEY = "0x" + "1".repeat(64);
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, address: "0xLeAd" }] });
      const engine = new CopyEngine("0xCore");
      await engine.start();
      expect(contractInstance.on).toHaveBeenCalledWith("OrderCreated", expect.any(Function));
      expect(engine.isLeadTrader("0xlead")).toBe(true);
      expect(engine.isLeadTrader("0xother")).toBe(false);
      // starting again is a no-op
      contractInstance.on.mockClear();
      await engine.start();
      expect(contractInstance.on).not.toHaveBeenCalled();
    });

    it("starts with a WebSocket provider when WS_RPC_URL is ws://", async () => {
      process.env.WS_RPC_URL = "wss://rpc.example";
      process.env.RPC_URL = "https://rpc.example";
      process.env.COPY_BOT_PRIVATE_KEY = "0x" + "1".repeat(64);
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const engine = new CopyEngine("0xCore");
      await engine.start();
      await engine.stop();
      expect(wsDestroy).toHaveBeenCalled();
      expect(contractInstance.removeAllListeners).toHaveBeenCalledWith("OrderCreated");
    });

    it("mirrors orders only for registered lead traders", async () => {
      process.env.RPC_URL = "https://rpc.example";
      process.env.COPY_BOT_PRIVATE_KEY = "0x" + "1".repeat(64);
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, address: "0xlead" }] });
      const engine = new CopyEngine("0xCore");
      await engine.start();
      // Non-lead account → handler returns immediately, no copier query.
      mockQuery.mockClear();
      await orderCreatedHandler(1n, "0xstranger", 0, "0xmarket");
      expect(mockQuery).not.toHaveBeenCalled();
      // Lead account with active copiers → queries copiers.
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, copier_address: "0xc" }] });
      await orderCreatedHandler(2n, "0xLEAD", 0, "0xmarket");
      expect(mockQuery).toHaveBeenCalled();
      // Lead account with no copiers → still handled gracefully.
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await orderCreatedHandler(3n, "0xlead", 0, "0xmarket");
    });

    it("handles errors thrown while mirroring", async () => {
      process.env.RPC_URL = "https://rpc.example";
      process.env.COPY_BOT_PRIVATE_KEY = "0x" + "1".repeat(64);
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, address: "0xlead" }] });
      const engine = new CopyEngine("0xCore");
      await engine.start();
      mockQuery.mockRejectedValueOnce(new Error("db fail"));
      await expect(orderCreatedHandler(4n, "0xlead", 0, "0xmarket")).resolves.toBeUndefined();
    });

    it("refreshLeadTraders reloads the set", async () => {
      const engine = new CopyEngine("0xCore");
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, address: "0xNEW" }] });
      await engine.refreshLeadTraders();
      expect(engine.isLeadTrader("0xnew")).toBe(true);
    });
  });

  describe("singleton helpers", () => {
    it("getCopyEngine returns null without an address", () => {
      expect(getCopyEngine()).toBeNull();
    });

    it("getCopyEngine creates and reuses a singleton", () => {
      const a = getCopyEngine("0xCore");
      const b = getCopyEngine();
      expect(a).not.toBeNull();
      expect(a).toBe(b);
    });

    it("resetCopyEngine clears the singleton", () => {
      getCopyEngine("0xCore");
      resetCopyEngine();
      expect(getCopyEngine()).toBeNull();
    });
  });
});
