"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const indexer_js_1 = require("../services/indexer.js");
const activeMarkets_js_1 = require("../services/activeMarkets.js");
const format_js_1 = require("../utils/format.js");
const router = (0, express_1.Router)();
router.get("/", async (_req, res) => {
    try {
        const [protocol, marketsResult] = await Promise.all([(0, indexer_js_1.fetchProtocol)(), (0, indexer_js_1.fetchMarkets)()]);
        let markets = marketsResult;
        const activeSet = await (0, activeMarkets_js_1.getActiveMarketAddresses)();
        if (activeSet && activeSet.size > 0) {
            markets = markets.filter((m) => {
                const addr = typeof m.marketAddress === "string" ? m.marketAddress : String(m.marketAddress);
                return activeSet.has(addr.toLowerCase());
            });
        }
        const totalMarkets = markets.length;
        const volume24h = protocol?.totalVolumeUsd ? (0, format_js_1.toDecimal)(protocol.totalVolumeUsd) : "0";
        let totalOpenInterest = "0";
        if (markets.length > 0) {
            const oi = markets.reduce((acc, m) => acc + Number(m.totalLongSize) + Number(m.totalShortSize), 0);
            totalOpenInterest = (oi / 1e12).toFixed(6);
        }
        const totalLiquidations = protocol?.totalLiquidations ? (0, format_js_1.toDecimal)(protocol.totalLiquidations) : "0";
        res.json({
            success: true,
            data: { totalMarkets, volume24h, totalOpenInterest, totalLiquidations },
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch stats";
        res.json({
            success: false,
            error: message,
            data: { totalMarkets: 0, volume24h: "0", totalOpenInterest: "0", totalLiquidations: "0" },
        });
    }
});
router.get("/history", async (_req, res) => {
    try {
        const metrics = await (0, indexer_js_1.fetchProtocolMetrics)(90, "day");
        const data = metrics.map((m) => {
            const ts = Number(m.timestamp) * 1000;
            const date = new Date(ts).toISOString().slice(0, 10);
            return {
                date,
                volume: (0, format_js_1.toDecimal)(m.volumeUsd),
                trades: Number(m.tradesCount) || 0,
                fees: (0, format_js_1.toDecimal)(m.feesUsd),
                pnl: "0", // ProtocolMetric does not expose daily pnl
            };
        });
        res.json({ success: true, data });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch stats history";
        res.json({ success: false, error: message, data: [] });
    }
});
exports.default = router;
