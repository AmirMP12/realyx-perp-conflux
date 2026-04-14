"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const indexer_js_1 = require("../services/indexer.js");
const router = (0, express_1.Router)();
const USDC_6 = 1e6;
router.get("/claims", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    try {
        const claims = await (0, indexer_js_1.fetchBadDebtClaims)(limit);
        const data = claims.map((c) => ({
            id: c.id,
            claimId: c.claimId,
            positionId: c.positionId,
            amount: c.amount,
            amountUsd: (Number(c.amount) / USDC_6).toFixed(2),
            submittedAt: new Date(Number(c.submittedAt) * 1000).toISOString(),
            coveredAt: c.coveredAt ? new Date(Number(c.coveredAt) * 1000).toISOString() : null,
            txHash: c.txHash.startsWith("0x") ? c.txHash : "0x" + c.txHash,
        }));
        res.json({ success: true, data });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch claims";
        res.json({ success: false, error: message, data: [] });
    }
});
exports.default = router;
