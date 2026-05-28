import { Router, Request, Response } from "express";
import { insertKeeperFailure } from "../services/indexer.js";

const router = Router();

/**
 * POST /api/v1/keeper/failure (internal)
 * Receives keeper failure webhooks from the keeper-bot and persists them,
 * then the wsServer broadcasts to the user channel.
 */
router.post("/failure", async (req: Request, res: Response) => {
  try {
    const { orderId, traderAddress, marketAddress, failureReason, selector } = req.body;

    if (!orderId || !traderAddress) {
      res.status(400).json({ success: false, error: "orderId and traderAddress are required" });
      return;
    }

    const persisted = await insertKeeperFailure({
      orderId: String(orderId),
      traderAddress: String(traderAddress).toLowerCase(),
      marketAddress: String(marketAddress || ""),
      failureReason: String(failureReason || "Unknown error"),
      selector: String(selector || ""),
    });

    // Forward to WebSocket broadcaster (attached to app in wsServer.ts)
    const broadcastFn = (req.app as any).__broadcastKeeperFailure;
    if (broadcastFn) {
      broadcastFn({
        orderId: String(orderId),
        traderAddress: String(traderAddress).toLowerCase(),
        failureReason: String(failureReason || "Unknown error"),
      });
    }

    res.json({ success: true, data: persisted });
  } catch (err) {
    console.error("[keeper] failure webhook error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /api/v1/keeper/failures/:traderAddress
 * Fetch historical keeper failures for a user.
 */
router.get("/failures/:traderAddress", async (req: Request, res: Response) => {
  try {
    const { traderAddress } = req.params;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 100);

    const { fetchKeeperFailures } = await import("../services/indexer.js");
    const failures = await fetchKeeperFailures(traderAddress, limit);

    res.json({ success: true, data: failures });
  } catch (err) {
    console.error("[keeper] fetch failures error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;