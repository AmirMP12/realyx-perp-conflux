"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const indexer_js_1 = require("../services/indexer.js");
const format_js_1 = require("../utils/format.js");
const router = (0, express_1.Router)();
router.get("/:address/positions", async (req, res) => {
    const address = (req.params.address ?? "").trim();
    if (!address) {
        return res.status(400).json({ success: false, error: "address required" });
    }
    try {
        const positions = await (0, indexer_js_1.fetchUserPositions)(address);
        const data = positions.map((p, i) => ({
            id: i + 1,
            market: {
                id: p.market.id,
                name: p.market.marketAddress.slice(0, 10) + "...",
                symbol: "NFT",
                collectionName: "",
                collectionImage: "",
            },
            side: p.isLong ? "LONG" : "SHORT",
            size: (0, format_js_1.toDecimal)(p.size),
            entryPrice: (0, format_js_1.toDecimal)(p.entryPrice),
            margin: (0, format_js_1.toDecimal)(p.collateralAmount),
            leverage: Number(p.leverage) || 1,
            unrealizedPnl: "0",
            realizedPnl: "0",
            liquidationPrice: (0, format_js_1.toDecimal)(p.liquidationPrice),
            breakEvenPrice: (0, format_js_1.toDecimal)(p.entryPrice),
            openTs: new Date(Number(p.openTimestamp) * 1000).toISOString(),
        }));
        res.json({ success: true, data });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch positions";
        res.json({ success: false, error: message, data: [] });
    }
});
router.get("/:address/trades", async (req, res) => {
    const address = (req.params.address ?? "").trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
    if (!address) {
        return res.status(400).json({ success: false, error: "address required" });
    }
    try {
        const trades = await (0, indexer_js_1.fetchUserTrades)(address, limit);
        const data = trades.map((t, i) => ({
            id: i + 1,
            signature: t.txHash,
            market: t.market.id,
            side: t.isLong ? "LONG" : "SHORT",
            size: (0, format_js_1.toDecimal)(t.size),
            price: (0, format_js_1.toDecimal)(t.price),
            leverage: 0,
            fee: (0, format_js_1.toDecimal)(t.fee),
            pnl: t.realizedPnl ? (0, format_js_1.toDecimal)(t.realizedPnl) : null,
            type: t.type === "LIQUIDATE" ? "LIQUIDATED" : t.type,
            timestamp: new Date(Number(t.timestamp) * 1000).toISOString(),
        }));
        res.json({ success: true, data });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch trades";
        res.json({ success: false, error: message, data: [] });
    }
});
exports.default = router;
