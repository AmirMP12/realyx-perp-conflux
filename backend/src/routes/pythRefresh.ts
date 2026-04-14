import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { config } from "../config.js";

const PYTH_ABI = [
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
  "function updatePriceFeeds(bytes[] calldata updateData) external payable",
];
const ORACLE_ABI = [
  "function pyth() external view returns (address)",
  "function getOracleConfig(address collection) external view returns (bytes32,uint256,uint256,uint256)",
];
const TRADING_CORE_ABI = ["function oracleAggregator() external view returns (address)"];

const HERMES_DEFAULT = "https://hermes.pyth.network";

function deploymentFileForChain(chainId: number): string {
  return chainId === 1030 ? "conflux.json" : "confluxTestnet.json";
}

function loadTradingCoreAddress(): string | null {
  const env =
    (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
  if (env) return env;
  try {
    const file = path.join(process.cwd(), "..", "deployment", deploymentFileForChain(config.chainId));
    if (!fs.existsSync(file)) return null;
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { contracts?: { tradingCore?: string } };
    return (j.contracts?.tradingCore ?? "").trim() || null;
  } catch {
    return null;
  }
}

async function fetchHermesUpdateDataHex(hermesBase: string, feedIdsHexNo0x: string[]): Promise<string[] | null> {
  if (feedIdsHexNo0x.length === 0) return null;
  const q = feedIdsHexNo0x.map((id) => `ids[]=${id.toLowerCase()}`).join("&");
  const url = `${hermesBase.replace(/\/+$/, "")}/v2/updates/price/latest?encoding=hex&${q}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hermes ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { binary?: { data?: string[] } };
  const raw = body.binary?.data ?? [];
  const updates = raw.filter(Boolean).map((d) => (d.startsWith("0x") ? d : `0x${d}`));
  return updates.length > 0 ? updates : null;
}

const router = Router();

/**
 * GET /api/pyth-refresh?markets=0xabc,0xdef
 * Pushes latest Hermes VAAs to on-chain Pyth (same as keeper price refresh).
 * Secured with CRON_SECRET when set (Bearer token), same pattern as /api/sync.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ success: false, error: "Unauthorized cron request" });
    }

    const pk =
      (process.env.PYTH_REFRESH_PRIVATE_KEY ?? process.env.KEEPER_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? "").trim();
    if (!pk) {
      return res.status(500).json({
        success: false,
        error: "Set PYTH_REFRESH_PRIVATE_KEY (or KEEPER_PRIVATE_KEY / PRIVATE_KEY) with a funded wallet",
      });
    }

    const tradingCoreAddress = loadTradingCoreAddress();
    if (!tradingCoreAddress) {
      return res.status(500).json({
        success: false,
        error: "TRADING_CORE_ADDRESS / DEPLOYED_TRADING_CORE or deployment/<network>.json missing",
      });
    }

    const marketsParam = String(req.query.markets ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (marketsParam.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Query required: ?markets=0xMarket1,0xMarket2 (oracle collection addresses)",
      });
    }

    const hermesBase = (process.env.HERMES_URL ?? HERMES_DEFAULT).replace(/\/+$/, "");
    const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
    const wallet = new ethers.Wallet(pk, provider);
    const tc = new ethers.Contract(tradingCoreAddress, TRADING_CORE_ABI, wallet);
    const oracleAddr = (await tc.oracleAggregator()) as string;
    const oracle = new ethers.Contract(oracleAddr, ORACLE_ABI, wallet);
    const pythAddr = (await oracle.pyth()) as string;
    const pyth = new ethers.Contract(pythAddr, PYTH_ABI, wallet);

    const feedSet = new Map<string, string>();
    for (const m of marketsParam) {
      if (!ethers.isAddress(m)) {
        return res.status(400).json({ success: false, error: `Invalid market address: ${m}` });
      }
      const cfg = await oracle.getOracleConfig(m);
      const feedId: string = cfg[0];
      if (feedId === ethers.ZeroHash) continue;
      feedSet.set(feedId.toLowerCase(), feedId);
    }
    const feeds = [...feedSet.values()];
    if (feeds.length === 0) {
      return res.json({ success: true, message: "No Pyth feeds for given markets", txHash: null });
    }

    const idHex = feeds.map((f) => f.replace(/^0x/i, ""));
    const updateData = await fetchHermesUpdateDataHex(hermesBase, idHex);
    if (!updateData) {
      return res.status(502).json({ success: false, error: "Hermes returned no binary update data" });
    }

    const updateFee = (await pyth.getUpdateFee(updateData)) as bigint;
    const tx = await pyth.updatePriceFeeds(updateData, { value: updateFee });
    const receipt = await tx.wait();
    return res.json({
      success: true,
      txHash: receipt?.hash ?? tx.hash,
      feedsUpdated: feeds.length,
      markets: marketsParam,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "pyth-refresh failed";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
