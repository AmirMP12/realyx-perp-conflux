import { jest } from "@jest/globals";

const readQuery = jest.fn<any>();
const writeQuery = jest.fn<any>();
let readPool: any = { query: readQuery };
let writePool: any = { query: writeQuery };

jest.mock("../services/db.js", () => ({
  __esModule: true,
  getReadPool: () => readPool,
  getWritePool: () => writePool,
  getEffectiveReadPool: async () => readPool,
  isUsingReadReplica: () => false,
  resetPools: jest.fn(),
}));

// fetchMarkets dynamically imports this; keep it cheap/empty.
jest.mock("../services/fetchMarketsOnchain.js", () => ({
  __esModule: true,
  fetchMarketsOnChain: async () => [],
}));

import * as indexer from "../services/indexer.js";

describe("indexer queries", () => {
  const prevPg = process.env.POSTGRES_URL;
  const prevNode = process.env.NODE_ENV;

  beforeEach(() => {
    readQuery.mockReset();
    writeQuery.mockReset();
    readPool = { query: readQuery };
    writePool = { query: writeQuery };
    readQuery.mockResolvedValue({ rows: [] });
    writeQuery.mockResolvedValue({ rows: [] });
    process.env.POSTGRES_URL = "postgres://test";
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    if (prevPg === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = prevPg;
    process.env.NODE_ENV = prevNode;
  });

  describe("fetchProtocol", () => {
    it("returns a deterministic mock in test mode without a DB", async () => {
      delete process.env.POSTGRES_URL;
      const p = await indexer.fetchProtocol();
      expect(p?.totalVolumeUsd).toBe("50000");
    });

    it("returns null without a DB outside test mode", async () => {
      delete process.env.POSTGRES_URL;
      process.env.NODE_ENV = "production";
      expect(await indexer.fetchProtocol()).toBeNull();
    });

    it("aggregates event counts and volumes from the DB", async () => {
      readQuery.mockImplementation((sql: string) => {
        if (sql.includes("GROUP BY event_type")) {
          return Promise.resolve({ rows: [
            { event_type: "PositionOpened", count: "5" },
            { event_type: "PositionClosed", count: "3" },
            { event_type: "PositionLiquidated", count: "1" },
          ] });
        }
        if (sql.includes("INTERVAL '24 hours'")) return Promise.resolve({ rows: [{ volume_usd: "1000" }] });
        return Promise.resolve({ rows: [{ volume_usd: "5000" }] });
      });
      const p = await indexer.fetchProtocol();
      expect(p?.totalTrades).toBe("9");
      expect(p?.volume24hUsd).toBe("1000");
      expect(p?.totalVolumeUsd).toBe("5000");
    });

    it("recovers when the volume queries reject", async () => {
      readQuery.mockImplementation((sql: string) => {
        if (sql.includes("GROUP BY event_type")) return Promise.resolve({ rows: [] });
        return Promise.reject(new Error("vol query failed"));
      });
      const p = await indexer.fetchProtocol();
      expect(p?.volume24hUsd).toBe("0");
    });

    it("returns null when the read pool is unavailable", async () => {
      readPool = null;
      expect(await indexer.fetchProtocol()).toBeNull();
    });

    it("returns null when the aggregate query throws", async () => {
      readQuery.mockRejectedValue(new Error("boom"));
      expect(await indexer.fetchProtocol()).toBeNull();
    });
  });

  describe("fetchActiveTraders24h", () => {
    it("returns 0 without a DB", async () => {
      delete process.env.POSTGRES_URL;
      expect(await indexer.fetchActiveTraders24h()).toBe(0);
    });
    it("returns the numeric count", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{ n: 7 }] });
      expect(await indexer.fetchActiveTraders24h()).toBe(7);
    });
    it("parses a string count", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{ n: "12" }] });
      expect(await indexer.fetchActiveTraders24h()).toBe(12);
    });
    it("returns 0 when the pool is missing", async () => {
      readPool = null;
      expect(await indexer.fetchActiveTraders24h()).toBe(0);
    });
    it("returns 0 on query error", async () => {
      readQuery.mockRejectedValueOnce(new Error("x"));
      expect(await indexer.fetchActiveTraders24h()).toBe(0);
    });
  });

  describe("fetchUserPositions", () => {
    it("returns [] for a non-hex address", async () => {
      expect(await indexer.fetchUserPositions("nothex")).toEqual([]);
    });
    it("maps an open position and computes margin from leverage", async () => {
      // On-chain the PositionOpened event carries `size` (internal precision,
      // 1e18-scaled) and `leverage` (also 1e18-scaled, e.g. 10x = 10e18).
      // margin = size * 1e18 / leverage, kept in the same 1e18 internal precision.
      readQuery.mockResolvedValueOnce({ rows: [{
        id: 9,
        data: JSON.stringify(["1", "0xt", "0xm", "true", "1000000000000000000000", "10000000000000000000", "2000"]),
        market_id: "0xm", block_number: 5, tx_hash: "0xh", created_at: new Date().toISOString(),
      }] });
      const pos = await indexer.fetchUserPositions("0xABC");
      expect(pos).toHaveLength(1);
      expect(pos[0].isLong).toBe(true);
      expect(pos[0].collateralAmount).toBe("100000000000000000000"); // 1000e18 * 1e18 / 10e18 = 100e18 ($100)
    });
    it("tolerates malformed JSON in the data column", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{
        id: 9, data: "not-json", market_id: "0xm", block_number: 5, tx_hash: "0xh", created_at: new Date().toISOString(),
      }] });
      const pos = await indexer.fetchUserPositions("0xABC");
      expect(pos).toHaveLength(1);
      expect(pos[0].collateralAmount).toBe("0");
    });
    it("returns [] when the pool is missing", async () => {
      readPool = null;
      expect(await indexer.fetchUserPositions("0xABC")).toEqual([]);
    });
    it("returns [] on query error", async () => {
      readQuery.mockRejectedValueOnce(new Error("x"));
      expect(await indexer.fetchUserPositions("0xABC")).toEqual([]);
    });
  });

  describe("fetchUserTrades", () => {
    it("returns [] for a non-hex address", async () => {
      expect(await indexer.fetchUserTrades("nothex", 10)).toEqual([]);
    });
    it("maps open, close (with open_data) and liquidation rows", async () => {
      readQuery.mockResolvedValueOnce({ rows: [
        { id: 1, event_type: "PositionOpened", data: JSON.stringify(["1", "0xt", "0xm", "true", "1000", "10", "2000"]), market_id: "0xm", block_number: 1, tx_hash: "0xa", created_at: new Date().toISOString() },
        { id: 2, event_type: "PositionClosed", data: JSON.stringify(["1", "0xt", "50", "2100"]), market_id: "0x", open_data: JSON.stringify(["1", "0xt", "0xm", "false", "900", "5", "2000"]), open_market_id: "0xm", block_number: 2, tx_hash: "0xb", created_at: new Date().toISOString() },
        { id: 3, event_type: "PositionLiquidated", data: JSON.stringify(["1", "0xliq", "1500"]), market_id: "0x", open_data: ["1", "0xt", "0xm", "true", "800", "4", "2000"], open_market_id: "0xm", block_number: 3, tx_hash: "0xc", created_at: new Date().toISOString() },
      ] });
      const trades = await indexer.fetchUserTrades("0xABC", 10);
      expect(trades).toHaveLength(3);
      expect(trades[0].type).toBe("OPEN");
      expect(trades[1].type).toBe("CLOSE");
      expect(trades[1].market.id).toBe("0xm"); // resolved from open_market_id
      expect(trades[2].type).toBe("LIQUIDATE");
    });
    it("returns [] when the pool is missing", async () => {
      readPool = null;
      expect(await indexer.fetchUserTrades("0xABC", 10)).toEqual([]);
    });
    it("returns [] on query error", async () => {
      readQuery.mockRejectedValueOnce(new Error("x"));
      expect(await indexer.fetchUserTrades("0xABC", 10)).toEqual([]);
    });
  });

  describe("fetchLeaderboard", () => {
    it("returns [] without a DB", async () => {
      delete process.env.POSTGRES_URL;
      expect(await indexer.fetchLeaderboard(10)).toEqual([]);
    });
    it("maps rows for the 24h timeframe", async () => {
      readQuery.mockResolvedValueOnce({ rows: [
        { address: "0x1", total_trades: "5", total_realized_pnl: "100", total_volume_usd: "2000" },
      ] });
      const lb = await indexer.fetchLeaderboard(10, "24h");
      expect(lb).toHaveLength(1);
      expect(lb[0].totalTrades).toBe("5");
    });
    it("maps rows for the 7d timeframe with default-applied fields", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{ address: "0x1", total_trades: "1" }] });
      const lb = await indexer.fetchLeaderboard(10, "7d");
      expect(lb[0].totalVolumeUsd).toBe("0");
      expect(lb[0].totalRealizedPnl).toBe("0");
    });
    it("returns [] on error outside production", async () => {
      readQuery.mockRejectedValueOnce(new Error("x"));
      process.env.NODE_ENV = "development";
      const lb = await indexer.fetchLeaderboard(10);
      expect(lb).toEqual([]);
    });
    it("returns [] on error in production", async () => {
      readQuery.mockRejectedValueOnce(new Error("x"));
      process.env.NODE_ENV = "production";
      expect(await indexer.fetchLeaderboard(10)).toEqual([]);
    });
  });

  describe("keeper + referral + metrics", () => {
    it("insertKeeperFailure returns null without a DB", async () => {
      delete process.env.POSTGRES_URL;
      expect(await indexer.insertKeeperFailure({ orderId: "1", traderAddress: "0xa", marketAddress: "0xm", failureReason: "r", selector: "s" })).toBeNull();
    });
    it("insertKeeperFailure persists and maps the row", async () => {
      writeQuery.mockResolvedValueOnce({ rows: [{ id: 1, order_id: "1", trader_address: "0xa", market_address: "0xm", failure_reason: "r", selector: "", created_at: new Date().toISOString() }] });
      const r = await indexer.insertKeeperFailure({ orderId: "1", traderAddress: "0xa", marketAddress: "0xm", failureReason: "r", selector: "" });
      expect(r?.orderId).toBe("1");
    });
    it("insertKeeperFailure returns null on error", async () => {
      writeQuery.mockRejectedValueOnce(new Error("x"));
      expect(await indexer.insertKeeperFailure({ orderId: "1", traderAddress: "0xa", marketAddress: "0xm", failureReason: "r", selector: "" })).toBeNull();
    });
    it("fetchKeeperFailures returns [] without a DB and maps rows otherwise", async () => {
      delete process.env.POSTGRES_URL;
      expect(await indexer.fetchKeeperFailures("0xa")).toEqual([]);
      process.env.POSTGRES_URL = "postgres://test";
      readQuery.mockResolvedValueOnce({ rows: [{ id: 1, order_id: "2", trader_address: "0xa", market_address: "0xm", failure_reason: "r", selector: "s", created_at: new Date().toISOString() }] });
      const f = await indexer.fetchKeeperFailures("0xA", 10);
      expect(f[0].orderId).toBe("2");
    });
    it("fetchKeeperFailures returns [] on error", async () => {
      readQuery.mockRejectedValueOnce(new Error("x"));
      expect(await indexer.fetchKeeperFailures("0xa")).toEqual([]);
    });
    it("fetchReferralEarned returns null for non-hex / no DB and a total otherwise", async () => {
      expect(await indexer.fetchReferralEarned("nothex")).toBeNull();
      readQuery.mockResolvedValueOnce({ rows: [{ total: "777" }] });
      expect(await indexer.fetchReferralEarned("0xABC")).toBe("777");
    });
    it("fetchReferralEarned returns null on error", async () => {
      readQuery.mockRejectedValueOnce(new Error("x"));
      expect(await indexer.fetchReferralEarned("0xABC")).toBeNull();
    });
    it("fetchProtocolMetrics handles hour + day period types and errors", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{ timestamp_text: "2024-01-01", timestamp_unix: "1700000000", volume_usd_raw: "1", fees_usd_raw: "2", trades_count: "3" }] });
      const hour = await indexer.fetchProtocolMetrics(24, "hour");
      expect(hour[0].periodType).toBe("hour");

      readQuery.mockResolvedValueOnce({ rows: [] });
      const day = await indexer.fetchProtocolMetrics(7, "day");
      expect(day).toEqual([]);

      delete process.env.POSTGRES_URL;
      expect(await indexer.fetchProtocolMetrics(7)).toEqual([]);
      process.env.POSTGRES_URL = "postgres://test";

      readQuery.mockRejectedValueOnce(new Error("x"));
      expect(await indexer.fetchProtocolMetrics(7)).toEqual([]);
    });
    it("fetchBadDebtClaims returns []", async () => {
      expect(await indexer.fetchBadDebtClaims(10)).toEqual([]);
    });
  });

  describe("default/fallback field arms", () => {
    it("fetchUserPositions applies defaults for sparse event args", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{
        id: 1, data: JSON.stringify(["1"]), market_id: "0xm", block_number: 1, tx_hash: "0xh", created_at: new Date().toISOString(),
      }] });
      const pos = await indexer.fetchUserPositions("0xABC");
      expect(pos[0].size).toBe("0");
      expect(pos[0].leverage).toBe("1");
    });

    it("fetchUserTrades applies defaults and resolves without open_data", async () => {
      readQuery.mockResolvedValueOnce({ rows: [
        { id: 1, event_type: "PositionOpened", data: JSON.stringify(["1"]), market_id: "0xm", block_number: 1, tx_hash: "0xa", created_at: new Date().toISOString() },
        { id: 2, event_type: "PositionClosed", data: JSON.stringify(["1"]), market_id: "0xm", open_data: null, open_market_id: null, block_number: 2, tx_hash: "0xb", created_at: new Date().toISOString() },
        { id: 3, event_type: "PositionLiquidated", data: JSON.stringify(["1"]), market_id: "0xm", open_data: "bad-json", open_market_id: null, block_number: 3, tx_hash: "0xc", created_at: new Date().toISOString() },
      ] });
      const trades = await indexer.fetchUserTrades("0xABC", 10);
      expect(trades).toHaveLength(3);
      expect(trades[0].size).toBe("0");
    });

    it("fetchLeaderboard defaults null pnl/volume fields", async () => {
      readQuery.mockResolvedValueOnce({ rows: [
        { address: "0x1", total_trades: "2", total_realized_pnl: null, total_volume_usd: null },
      ] });
      const lb = await indexer.fetchLeaderboard(10);
      expect(lb[0].totalRealizedPnl).toBe("0");
      expect(lb[0].totalVolumeUsd).toBe("0");
    });

    it("insertKeeperFailure defaults a null selector to empty string", async () => {
      writeQuery.mockResolvedValueOnce({ rows: [{ id: 1, order_id: "1", trader_address: "0xa", market_address: "0xm", failure_reason: "r", selector: null, created_at: new Date().toISOString() }] });
      const r = await indexer.insertKeeperFailure({ orderId: "1", traderAddress: "0xa", marketAddress: "0xm", failureReason: "r", selector: "" });
      expect(r?.selector).toBe("");
    });

    it("fetchKeeperFailures defaults a null selector to empty string", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{ id: 1, order_id: "2", trader_address: "0xa", market_address: "0xm", failure_reason: "r", selector: null, created_at: new Date().toISOString() }] });
      const f = await indexer.fetchKeeperFailures("0xA", 10);
      expect(f[0].selector).toBe("");
    });

    it("fetchReferralEarned defaults a null sum to '0'", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{ total: null }] });
      expect(await indexer.fetchReferralEarned("0xABC")).toBe("0");
    });
  });

  describe("null-pool guards and bad-debt mapping", () => {
    it("insertKeeperFailure returns null when the write pool is unavailable", async () => {
      writePool = null;
      const r = await indexer.insertKeeperFailure({
        orderId: "1", traderAddress: "0xa", marketAddress: "0xm", failureReason: "r", selector: "s",
      });
      expect(r).toBeNull();
    });

    it("fetchKeeperFailures returns [] when the read pool is unavailable", async () => {
      readPool = null;
      expect(await indexer.fetchKeeperFailures("0xA", 10)).toEqual([]);
    });

    it("fetchReferralEarned returns null when the read pool is unavailable", async () => {
      readPool = null;
      expect(await indexer.fetchReferralEarned("0xABC")).toBeNull();
    });

    it("fetchBadDebtClaims returns [] without a DB", async () => {
      delete process.env.POSTGRES_URL;
      expect(await indexer.fetchBadDebtClaims(10)).toEqual([]);
    });

    it("fetchBadDebtClaims returns [] when the read pool is unavailable", async () => {
      readPool = null;
      expect(await indexer.fetchBadDebtClaims(10)).toEqual([]);
    });

    it("fetchBadDebtClaims maps rows and handles missing block_time with an invalid limit", async () => {
      readQuery.mockResolvedValueOnce({ rows: [
        { id: 1, claim_id: "c1", position_id: "p1", amount: "100", block_number: 5, tx_hash: "0xh1", block_time: 1700000000 },
        { id: 2, claim_id: "c2", position_id: "p2", amount: "200", block_number: 6, tx_hash: "0xh2", block_time: null },
      ] });
      const claims = await indexer.fetchBadDebtClaims(NaN as unknown as number);
      expect(claims).toHaveLength(2);
      // block_time present -> stringified; absent -> "0"
      expect(claims[0].coveredAt).toBe("1700000000");
      expect(claims[1].coveredAt).toBe("0");
    });

    it("fetchBadDebtClaims returns [] on query error", async () => {
      readQuery.mockRejectedValueOnce(new Error("boom"));
      expect(await indexer.fetchBadDebtClaims(10)).toEqual([]);
    });

    it("fetchUserTrades tolerates malformed event data and resolves size default from open args", async () => {
      // malformed data JSON, with open args present but no size element
      // (size falls back to "0").
      readQuery.mockResolvedValueOnce({ rows: [{
        id: 1, event_type: "PositionClosed",
        data: "not-json",
        market_id: "0x",
        open_data: JSON.stringify(["1", "y", "z"]),
        open_market_id: "0xMKT",
        block_number: 1, tx_hash: "0xb", created_at: new Date().toISOString(),
      }] });
      const trades = await indexer.fetchUserTrades("0xABC", 10);
      expect(trades).toHaveLength(1);
      expect(trades[0].size).toBe("0");
      expect(trades[0].market.id).toBe("0xMKT");
    });

    it("fetchUserTrades prefers typed event columns for open/close/liquidate rows", async () => {
      // uses typed columns: is_long/size_raw/entry_price on OPEN,
      // realized_pnl/exit_price on CLOSE, exit_price on LIQUIDATE.
      readQuery.mockResolvedValueOnce({ rows: [
        {
          id: 1, event_type: "PositionOpened",
          data: JSON.stringify(["1", "x", "0xm", "false", "111", "5", "1"]),
          is_long: true, size_raw: "7777", entry_price: "31000",
          market_id: "0xm", block_number: 1, tx_hash: "0xa", created_at: new Date().toISOString(),
        },
        {
          id: 2, event_type: "PositionClosed",
          data: JSON.stringify(["1", "x", "9", "8"]),
          realized_pnl: "250", exit_price: "32000",
          market_id: "0xm", open_data: null, open_market_id: null,
          block_number: 2, tx_hash: "0xb", created_at: new Date().toISOString(),
        },
        {
          id: 3, event_type: "PositionLiquidated",
          data: JSON.stringify(["1", "0xliq", "7"]),
          exit_price: "29000",
          market_id: "0xm", open_data: null, open_market_id: null,
          block_number: 3, tx_hash: "0xc", created_at: new Date().toISOString(),
        },
      ] });
      const trades = await indexer.fetchUserTrades("0xABC", 10);
      expect(trades[0].isLong).toBe(true);
      expect(trades[0].size).toBe("7777");
      expect(trades[0].price).toBe("31000");
      expect(trades[1].realizedPnl).toBe("250");
      expect(trades[1].price).toBe("32000");
      expect(trades[2].price).toBe("29000");
    });

    it("fetchUserPositions maps from typed columns when present", async () => {
      // hasTyped path: position_id/is_long/size_raw/leverage_raw/entry_price
      // are read directly instead of the legacy positional JSON.
      readQuery.mockResolvedValueOnce({ rows: [{
        id: 7,
        data: JSON.stringify(["legacy", "ignored"]),
        position_id: "42",
        is_long: true,
        size_raw: "2000000000000000000000",
        leverage_raw: "20000000000000000000",
        entry_price: "30000",
        market_id: "0xm", block_number: 9, tx_hash: "0xh", created_at: new Date().toISOString(),
      }] });
      const pos = await indexer.fetchUserPositions("0xABC");
      expect(pos[0].positionId).toBe("42");
      expect(pos[0].isLong).toBe(true);
      expect(pos[0].size).toBe("2000000000000000000000");
      expect(pos[0].leverage).toBe("20000000000000000000");
      expect(pos[0].entryPrice).toBe("30000");
    });

    it("fetchUserTrades resolves from typed open columns when present", async () => {
      // resolveFromOpen prefers typed open_is_long/open_size_raw
      // over the positional open_data JSON.
      readQuery.mockResolvedValueOnce({ rows: [{
        id: 1, event_type: "PositionClosed",
        data: JSON.stringify(["1", "x", "50", "2000"]),
        market_id: "0x",
        open_data: JSON.stringify(["1", "y", "z", "false", "111"]),
        open_is_long: true,
        open_size_raw: "5000",
        open_market_id: "0xMKT", block_number: 1, tx_hash: "0xb", created_at: new Date().toISOString(),
      }] });
      const trades = await indexer.fetchUserTrades("0xABC", 10);
      expect(trades[0].isLong).toBe(true);
      expect(trades[0].size).toBe("5000");
    });

    it("fetchUserPositions keeps margin at 0 when leverage is non-positive", async () => {
      readQuery.mockResolvedValueOnce({ rows: [{
        id: 1,
        data: JSON.stringify(["1", "x", "z", "true", "1000", "0", "2000"]),
        market_id: "0xm", block_number: 1, tx_hash: "0xh", created_at: new Date().toISOString(),
      }] });
      const pos = await indexer.fetchUserPositions("0xABC");
      expect(pos[0].size).toBe("1000");
      expect(pos[0].collateralAmount).toBe("0");
    });

    it("fetchUserTrades resolves isLong/size/market from open_data and open_market_id", async () => {
      readQuery.mockResolvedValueOnce({ rows: [
        {
          id: 1, event_type: "PositionClosed",
          data: JSON.stringify(["1", "x", "50", "2000"]),
          market_id: "0x",
          open_data: JSON.stringify(["1", "y", "z", "true", "999"]),
          open_market_id: "0xMKT", block_number: 1, tx_hash: "0xb", created_at: new Date().toISOString(),
        },
        {
          id: 2, event_type: "PositionLiquidated",
          data: JSON.stringify(["1", "x", "60"]),
          market_id: "0x",
          open_data: JSON.stringify(["1", "y", "z", "false", "888"]),
          open_market_id: "0xMKT2", block_number: 2, tx_hash: "0xc", created_at: new Date().toISOString(),
        },
      ] });
      const trades = await indexer.fetchUserTrades("0xABC", 10);
      expect(trades[0].market.id).toBe("0xMKT");
      expect(trades[0].size).toBe("999");
      expect(trades[0].isLong).toBe(true);
      expect(trades[1].market.id).toBe("0xMKT2");
      expect(trades[1].size).toBe("888");
      expect(trades[1].isLong).toBe(false);
    });
  });
});
