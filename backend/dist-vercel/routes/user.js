import { Router } from "express";
import { fetchUserPositions, fetchUserTrades } from "../services/indexer.js";
import { toDecimal } from "../utils/format.js";
const router = Router();
router.get("/:address/positions", async (req, res) => {
    const address = (req.params.address ?? "").trim();
    if (!address) {
        return res.status(400).json({ success: false, error: "address required" });
    }
    try {
        const positions = await fetchUserPositions(address);
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
            size: toDecimal(p.size),
            entryPrice: toDecimal(p.entryPrice),
            margin: toDecimal(p.collateralAmount),
            leverage: Number(p.leverage) || 1,
            unrealizedPnl: "0",
            realizedPnl: "0",
            liquidationPrice: toDecimal(p.liquidationPrice),
            breakEvenPrice: toDecimal(p.entryPrice),
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
        const trades = await fetchUserTrades(address, limit);
        const data = trades.map((t, i) => ({
            id: i + 1,
            signature: t.txHash,
            market: t.market.id,
            side: t.isLong ? "LONG" : "SHORT",
            size: toDecimal(t.size),
            price: toDecimal(t.price),
            leverage: 0,
            fee: toDecimal(t.fee),
            pnl: t.realizedPnl ? toDecimal(t.realizedPnl) : null,
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
export default router;
