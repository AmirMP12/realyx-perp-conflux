import { jest } from "@jest/globals";

let lbImpl: any = async () => [];

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchLeaderboard: (...a: any[]) => lbImpl(...a),
}));

import request from "supertest";
import { app } from "../app.js";

describe("leaderboard timeframe and error handling", () => {
  beforeEach(() => {
    lbImpl = async () => [
      { address: "0x1", totalRealizedPnl: "1000000000000000000", totalVolumeUsd: "5000", totalTrades: "3" },
    ];
  });

  it.each(["24h", "7d", "alltime", "all", "bogus", undefined])(
    "resolves timeframe=%s and maps entries",
    async (tf) => {
      const url = tf === undefined ? "/api/leaderboard" : `/api/leaderboard?timeframe=${tf}`;
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].rank).toBe(1);
    },
  );

  it("handles a leaderboard fetch error", async () => {
    lbImpl = async () => { throw new Error("idx down"); };
    const res = await request(app).get("/api/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });
});
