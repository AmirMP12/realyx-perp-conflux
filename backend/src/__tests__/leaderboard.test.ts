import request from "supertest";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

jest.mock("../services/indexer.js", () => ({
  ...jest.requireActual("../services/indexer.js"),
  fetchLeaderboard: jest.fn(),
}));

import { app } from "../app.js";
import { fetchLeaderboard } from "../services/indexer.js";

describe("Leaderboard API", () => {
  beforeEach(() => {
    (fetchLeaderboard as jest.Mock).mockReset();
  });

  it("returns top traders from indexer", async () => {
    (fetchLeaderboard as jest.Mock).mockResolvedValue([
      {
        address: "0x123",
        totalRealizedPnl: "5000000000000000000",
        totalVolumeUsd: "1000000000000000000000",
        totalTrades: "10",
      },
      {
        address: "0x456",
        totalRealizedPnl: "2500000000000000000",
        totalVolumeUsd: "500000000000000000000",
        totalTrades: "5",
      },
    ]);

    const res = await request(app).get("/api/leaderboard?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].wallet).toBe("0x123");
    expect(fetchLeaderboard).toHaveBeenCalledWith(10, "all");
  });

  it("passes timeframe to indexer", async () => {
    (fetchLeaderboard as jest.Mock).mockResolvedValue([]);
    await request(app).get("/api/leaderboard?limit=5&timeframe=24h");
    expect(fetchLeaderboard).toHaveBeenCalledWith(5, "24h");
    await request(app).get("/api/leaderboard?timeframe=all%20time");
    expect(fetchLeaderboard).toHaveBeenCalledWith(10, "all");
  });

  it("handles indexer errors gracefully", async () => {
    (fetchLeaderboard as jest.Mock).mockRejectedValue(new Error("Offline"));

    const res = await request(app).get("/api/leaderboard?limit=100");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });
});
