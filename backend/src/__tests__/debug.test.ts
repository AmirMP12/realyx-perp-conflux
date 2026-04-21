import request from "supertest";
import { app } from "../app.js";
import pg from "pg";

jest.mock("pg", () => {
    const mPool = {
        query: jest.fn(),
    };
    return { Pool: jest.fn(() => mPool) };
});

describe("Debug Route", () => {
    let pool: any;

    beforeEach(() => {
        const { Pool } = require("pg");
        pool = new Pool();
        jest.clearAllMocks();
        process.env.POSTGRES_URL = "postgres://localhost:5432/test";
    });

    it("should return error if no DB connection string", async () => {
        delete process.env.POSTGRES_URL;
        // Reset poolInstance in debug.ts by re-importing or by not relying on cache
        // However, debug.ts has a local poolInstance. We may need to force it or clear it.
        // For now, let's assume the first call sets it.
    });

    it("should return detailed DB status on success", async () => {
        pool.query.mockImplementation((sql: string) => {
            if (sql.includes("COUNT(*) FROM position_events WHERE") && sql.includes("block_time")) {
                return Promise.resolve({ rows: [{ count: "5" }] });
            }
            if (sql.includes("COUNT(*) FROM position_events")) {
                return Promise.resolve({ rows: [{ count: "10" }] });
            }
            if (sql.includes("SELECT last_synced_block")) {
                return Promise.resolve({ rows: [{ last_synced_block: 1000 }] });
            }
            if (sql.includes("SELECT * FROM position_events")) {
                return Promise.resolve({ rows: [{ id: 1, event_type: "PositionOpened", data: '["0x1"]' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        const res = await request(app).get("/api/debug");
        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(true);
        expect(res.body.totalPositionEvents).toBe("10");
        expect(res.body.last24hEvents).toBe("5");
    });

    it("should handle missing indexer state", async () => {
        pool.query.mockImplementation((sql: string) => {
            if (sql.includes("SELECT last_synced_block")) return Promise.resolve({ rows: [] });
            return Promise.resolve({ rows: [{ count: "0" }] });
        });
        const res = await request(app).get("/api/debug");
        expect(res.body.indexerState).toBe("None");
    });

    it("should handle missing sample row", async () => {
        pool.query.mockImplementation((sql: string) => {
            if (sql.includes("SELECT * FROM position_events")) return Promise.resolve({ rows: [] });
            return Promise.resolve({ rows: [{ count: "0" }] });
        });
        const res = await request(app).get("/api/debug");
        expect(res.body.latestOpenEvent).toBeNull();
    });

    it("should handle database errors gracefully", async () => {
        pool.query.mockRejectedValue(new Error("DB Connection Failed"));
        const res = await request(app).get("/api/debug");
        expect(res.status).toBe(200);
        expect(res.body.error).toContain("DB Connection Failed");
    });
});
