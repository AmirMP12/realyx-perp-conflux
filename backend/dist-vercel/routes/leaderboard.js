"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const indexer_js_1 = require("../services/indexer.js");
const format_js_1 = require("../utils/format.js");
const router = (0, express_1.Router)();
router.get("/", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    try {
        const users = await (0, indexer_js_1.fetchLeaderboard)(limit);
        const data = users.map((u, i) => ({
            rank: i + 1,
            wallet: u.address,
            pnl: (0, format_js_1.toDecimal)(u.totalRealizedPnl),
            volume: (0, format_js_1.toDecimal)(u.totalVolumeUsd),
            trades: Number(u.totalTrades) || 0,
        }));
        res.json({ success: true, data });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch leaderboard";
        res.json({ success: false, error: message, data: [] });
    }
});
exports.default = router;
