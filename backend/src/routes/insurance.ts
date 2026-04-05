import { Router, Request, Response } from "express";
import { fetchBadDebtClaims } from "../services/subgraph.js";
import type { ApiResponse, InsuranceClaim } from "../types/index.js";

const router = Router();
const USDC_6 = 1e6;

router.get("/claims", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  try {
    const claims = await fetchBadDebtClaims(limit);
    const data: InsuranceClaim[] = claims.map((c) => ({
      id: c.id,
      claimId: c.claimId,
      positionId: c.positionId,
      amount: c.amount,
      amountUsd: (Number(c.amount) / USDC_6).toFixed(2),
      submittedAt: new Date(Number(c.submittedAt) * 1000).toISOString(),
      coveredAt: c.coveredAt ? new Date(Number(c.coveredAt) * 1000).toISOString() : null,
      txHash: c.txHash.startsWith("0x") ? c.txHash : "0x" + c.txHash,
    }));
    res.json({ success: true, data } as ApiResponse<InsuranceClaim[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch claims";
    res.json({ success: false, error: message, data: [] } as ApiResponse<InsuranceClaim[]>);
  }
});

export default router;
