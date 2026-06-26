import { jest } from "@jest/globals";

let positionsImpl: any = async () => [];
let tradesImpl: any = async () => [];

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchUserPositions: (...a: any[]) => positionsImpl(...a),
  fetchUserTrades: (...a: any[]) => tradesImpl(...a),
}));

import request from "supertest";
import { app } from "../app.js";

describe("user routes", () => {
  beforeEach(() => {
    positionsImpl = async () => [];
    tradesImpl = async () => [];
  });

  it("maps positions including long/short sides", async () => {
    positionsImpl = async () => [
      {
        market: { id: "0x986a383f6de4a24dd3f524f0f93546229b58265f", marketAddress: "0x986a383f6de4a24dd3f524f0f93546229b58265f" },
        isLong: true, size: "1000", entryPrice: "2000", collateralAmount: "100",
        leverage: "10", liquidationPrice: "1800", openTimestamp: "1600000000",
      },
      {
        market: { id: "0xshort", marketAddress: "0xshortaddress0000000000000000000000000000" },
        isLong: false, size: "500", entryPrice: "100", collateralAmount: "50",
        leverage: "0", liquidationPrice: "90", openTimestamp: "1600000000",
      },
    ];
    const res = await request(app).get("/api/user/0xabc/positions");
    expect(res.status).toBe(200);
    expect(res.body.data[0].side).toBe("LONG");
    expect(res.body.data[1].side).toBe("SHORT");
    expect(res.body.data[1].leverage).toBe(1); // 0 || 1
  });

  it("returns 400 for a missing positions address", async () => {
    const res = await request(app).get("/api/user/%20/positions");
    expect(res.status).toBe(400);
  });

  it("handles a positions fetch error", async () => {
    positionsImpl = async () => { throw new Error("idx down"); };
    const res = await request(app).get("/api/user/0xabc/positions");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it("maps trades with known + unknown symbols, pnl present/absent and types", async () => {
    tradesImpl = async () => [
      { txHash: "0x1", market: { id: "0x986a383f6de4a24dd3f524f0f93546229b58265f" }, isLong: true, size: "1", price: "2", fee: "3", realizedPnl: "5", type: "OPEN", timestamp: "1600000000" },
      { txHash: "0x2", market: { id: "0xunknownmarketaddress00000000000000000000" }, isLong: false, size: "1", price: "2", fee: "3", realizedPnl: "0", type: "LIQUIDATE", timestamp: "1600000000" },
      { txHash: "0x3", market: { id: "short" }, isLong: false, size: "1", price: "2", fee: "3", realizedPnl: null, type: "CLOSE", timestamp: "1600000000" },
    ];
    const res = await request(app).get("/api/user/0xabc/trades");
    expect(res.status).toBe(200);
    expect(res.body.data[0].market).toBe("BTC-USD"); // known symbol
    expect(res.body.data[0].pnl).not.toBeNull();
    expect(res.body.data[1].type).toBe("LIQUIDATED");
    expect(res.body.data[1].market).toContain("…"); // truncated unknown long address
    expect(res.body.data[2].market).toBe("short"); // short string returned as-is
    expect(res.body.data[2].pnl).toBeNull();
  });

  it("returns 400 for a missing trades address", async () => {
    const res = await request(app).get("/api/user/%20/trades");
    expect(res.status).toBe(400);
  });

  it("handles a trades fetch error", async () => {
    tradesImpl = async () => { throw new Error("idx down"); };
    const res = await request(app).get("/api/user/0xabc/trades?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it("uses the generic message when positions throws a non-Error", async () => {
    positionsImpl = async () => { throw "string failure"; };
    const res = await request(app).get("/api/user/0xabc/positions");
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Failed to fetch positions");
  });

  it("uses the generic message when trades throws a non-Error", async () => {
    tradesImpl = async () => { throw "string failure"; };
    const res = await request(app).get("/api/user/0xabc/trades");
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Failed to fetch trades");
  });
});
