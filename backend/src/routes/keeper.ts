import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { insertKeeperFailure } from "../services/indexer.js";
import { recordKeeperFailure, recordKeeperLatency } from "../middleware/metrics.js";

const router = Router();

/**
 * Authenticate internal keeper webhooks.
 *
 * The keeper-bot must send `Authorization: Bearer <KEEPER_WEBHOOK_SECRET>`.
 * If the secret is not configured the endpoint is refused (fail closed) in
 * production, but allowed in non-production to keep local development simple.
 */
function requireKeeperAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = (process.env.KEEPER_WEBHOOK_SECRET ?? "").trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ success: false, error: "Keeper webhook not configured" });
      return;
    }
    next();
    return;
  }

  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * POST /api/v1/keeper/failure (internal)
 * Receives keeper failure webhooks from the keeper-bot and persists them,
 * then the wsServer broadcasts to the user channel.
 */
router.post("/failure", requireKeeperAuth, async (req: Request, res: Response) => {
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

    // Surface keeper execution failures to Prometheus for the keeper-health alert.
    recordKeeperFailure();

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
 * POST /api/v1/keeper/executed (internal)
 * Optional success webhook from the keeper-bot reporting execution latency
 * (seconds from order creation to on-chain execution). Feeds the keeper-latency
 * histogram so we can alert on slow execution before users complain.
 */
router.post("/executed", requireKeeperAuth, (req: Request, res: Response) => {
  try {
    const { latencySeconds, latencyMs } = req.body ?? {};
    let seconds: number | undefined;
    if (latencySeconds != null && Number.isFinite(Number(latencySeconds))) {
      seconds = Number(latencySeconds);
    } else if (latencyMs != null && Number.isFinite(Number(latencyMs))) {
      seconds = Number(latencyMs) / 1000;
    }
    if (seconds == null || seconds < 0) {
      res.status(400).json({ success: false, error: "latencySeconds or latencyMs is required" });
      return;
    }
    recordKeeperLatency(seconds);
    res.json({ success: true });
  } catch (err) {
    console.error("[keeper] executed webhook error:", err);
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
