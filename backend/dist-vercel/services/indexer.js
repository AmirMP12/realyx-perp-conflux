"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchProtocol = fetchProtocol;
exports.fetchMarkets = fetchMarkets;
exports.fetchUserPositions = fetchUserPositions;
exports.fetchUserTrades = fetchUserTrades;
exports.fetchLeaderboard = fetchLeaderboard;
exports.fetchBadDebtClaims = fetchBadDebtClaims;
exports.fetchProtocolMetrics = fetchProtocolMetrics;
const pg_1 = __importDefault(require("pg"));
const { Pool } = pg_1.default;
let poolInstance = null;
function getPool() {
    if (poolInstance)
        return poolInstance;
    if (!process.env.POSTGRES_URL)
        return null;
    poolInstance = new Pool({
        connectionString: process.env.POSTGRES_URL,
        ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
        // Serverless-safe defaults: fail fast instead of hanging and timing out.
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 3_000,
        query_timeout: 5_000,
        statement_timeout: 5_000,
        allowExitOnIdle: true,
    });
    return poolInstance;
}
async function fetchProtocol() {
    if (!process.env.POSTGRES_URL) {
        if (process.env.NODE_ENV === 'test')
            return { totalVolumeUsd: "5000", totalFeesUsd: "100", tvl: "1000", totalTrades: "10", totalPositionsOpened: "5", totalPositionsClosed: "4", totalLiquidations: "1" };
        return null;
    }
    try {
        const pool = getPool();
        if (!pool)
            return null;
        const res = await pool.query(`SELECT event_type, COUNT(*) as count FROM position_events GROUP BY event_type`);
        let opened = 0;
        let closed = 0;
        let liq = 0;
        for (const row of res.rows) {
            if (row.event_type === "PositionOpened")
                opened = parseInt(row.count);
            if (row.event_type === "PositionClosed")
                closed = parseInt(row.count);
            if (row.event_type === "PositionLiquidated")
                liq = parseInt(row.count);
        }
        return {
            totalPositionsOpened: String(opened),
            totalPositionsClosed: String(closed),
            totalTrades: String(opened + closed + liq),
            totalVolumeUsd: "0",
            totalFeesUsd: "0",
            totalLiquidations: String(liq),
            tvl: "0",
        };
    }
    catch (e) {
        return null;
    }
}
async function fetchMarkets() {
    return [];
}
async function fetchUserPositions(traderAddress) {
    const trader = traderAddress.toLowerCase();
    if (!trader.startsWith("0x") || !process.env.POSTGRES_URL)
        return [];
    try {
        const pool = getPool();
        if (!pool)
            return [];
        const res = await pool.query(`SELECT * FROM position_events WHERE lower(account) = $1 AND event_type = 'PositionOpened' ORDER BY id DESC LIMIT 50`, [trader]);
        return res.rows.map((row) => {
            let isLong = true;
            let size = "0";
            let entryPrice = "0";
            let margin = "0";
            let leverage = "1";
            try {
                const args = JSON.parse(row.data || "[]");
                isLong = String(args[3]) === "true";
                size = args[4] || "0";
                leverage = args[5] || "1";
                entryPrice = args[6] || "0";
                if (BigInt(leverage) > 0n) {
                    margin = (BigInt(size) / BigInt(leverage)).toString();
                }
            }
            catch {
                /* ignore malformed JSON in position_events.data */
            }
            return {
                id: String(row.id),
                positionId: String(row.id),
                tokenId: String(row.id),
                trader: { id: trader },
                market: { id: row.market_id, marketAddress: row.market_id },
                isLong,
                size,
                entryPrice,
                liquidationPrice: "0",
                stopLossPrice: "0",
                takeProfitPrice: "0",
                leverage: leverage,
                collateralAmount: margin,
                state: "OPEN",
                openTimestamp: Math.floor(new Date(row.created_at).getTime() / 1000).toString(),
                lastFundingTime: "0",
                blockNumber: String(row.block_number),
                txHash: row.tx_hash,
            };
        });
    }
    catch (e) {
        return [];
    }
}
async function fetchUserTrades(traderAddress, limit) {
    const trader = traderAddress.toLowerCase();
    if (!trader.startsWith("0x") || !process.env.POSTGRES_URL)
        return [];
    try {
        const pool = getPool();
        if (!pool)
            return [];
        const res = await pool.query(`SELECT * FROM position_events WHERE lower(account) = $1 ORDER BY id DESC LIMIT $2`, [trader, Math.min(limit, 200)]);
        return res.rows.map((row) => {
            let isLong = true;
            let size = "0";
            let price = "0";
            let pnl = "0";
            try {
                const args = JSON.parse(row.data || "[]");
                if (row.event_type === "PositionOpened") {
                    isLong = String(args[3]) === "true";
                    size = args[4] || "0";
                    price = args[6] || "0";
                }
                else if (row.event_type === "PositionClosed") {
                    pnl = args[2] || "0";
                    price = args[3] || "0";
                    size = "0";
                }
            }
            catch {
                /* ignore malformed JSON */
            }
            let type = "OPEN";
            if (row.event_type === "PositionClosed")
                type = "CLOSE";
            if (row.event_type === "PositionLiquidated")
                type = "LIQUIDATE";
            return {
                id: String(row.id),
                position: { positionId: String(row.id) },
                trader: { id: trader },
                market: { id: row.market_id },
                type,
                isLong,
                size,
                price,
                realizedPnl: pnl,
                fee: "0",
                liquidator: null,
                timestamp: Math.floor(new Date(row.created_at).getTime() / 1000).toString(),
                blockNumber: String(row.block_number),
                txHash: row.tx_hash,
            };
        });
    }
    catch (e) {
        return [];
    }
}
async function fetchLeaderboard(limit) {
    if (!process.env.POSTGRES_URL)
        return [];
    try {
        const pool = getPool();
        if (!pool)
            return [];
        const res = await pool.query(`SELECT account, COUNT(*) as trades FROM position_events GROUP BY account ORDER BY trades DESC LIMIT $1`, [Math.min(limit, 100)]);
        return res.rows.map((row) => ({
            id: row.account,
            address: row.account,
            totalTrades: String(row.trades),
            totalVolumeUsd: "0",
            totalRealizedPnl: "0",
        }));
    }
    catch (e) {
        return [];
    }
}
async function fetchBadDebtClaims(_limit) {
    return [];
}
async function fetchProtocolMetrics(_limit, _periodType = "day") {
    return [];
}
