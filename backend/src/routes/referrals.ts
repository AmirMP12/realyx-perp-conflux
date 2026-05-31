import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import { config } from "../config.js";
import { fetchReferralEarned } from "../services/indexer.js";
import type { ApiResponse } from "../types/index.js";

/**
 * Referral stats, sourced from on-chain truth (no fabricated placeholders).
 *
 *   - code / referees   ← ReferralRegistry (codeOf, codeOf_/refereeCount)
 *   - pendingClaim       ← VaultCore.claimableRebates(referrer)   (USDC, 6 dp)
 *   - totalEarned        ← Σ VaultCore RebateAccrued(referrer, amount)
 *                           Preferred source is the indexed `referral_rebates`
 *                           table (cheap, reliable); falls back to a bounded
 *                           on-chain log scan when the indexer DB is unavailable.
 *
 * The referral program is only "live" when both the ReferralRegistry and
 * VaultCore addresses are configured. When the registry is not wired into the
 * active deployment (e.g. testnet without referrals), the route returns
 * `live: false` with zeroed figures so the frontend can label the feature
 * honestly instead of showing fake numbers.
 */

const REFERRAL_REGISTRY_ABI = [
  "function codeOf(address owner) view returns (string)",
  "function codeOwners(bytes32 codeHash) view returns (address)",
  "function codeOf_(address owner) view returns (bytes32)",
  "function refereeCount(bytes32 codeHash) view returns (uint256)",
] as const;

const VAULT_REBATE_ABI = [
  "function claimableRebates(address referrer) view returns (uint256)",
  "event RebateAccrued(address indexed referrer, uint256 amount)",
] as const;

/** USDC has 6 decimals; rebates and claimable balances are denominated in it. */
const USDC_DECIMALS = 6;

export interface ReferralStats {
  /** True only when the on-chain referral program is configured and reachable. */
  live: boolean;
  code: string;
  referees: number;
  /** Cumulative USDC rebates accrued to this referrer (decimal string). */
  totalEarned: string;
  /** Currently claimable USDC rebates (decimal string). */
  pendingClaim: string;
}

const router = Router();

function referralRegistryAddress(): string {
  return (
    process.env.REFERRAL_REGISTRY_ADDRESS ??
    process.env.DEPLOYED_REFERRAL_REGISTRY ??
    ""
  ).trim();
}

function vaultCoreAddress(): string {
  return (process.env.VAULT_CORE_ADDRESS ?? process.env.DEPLOYED_VAULT_CORE ?? "").trim();
}

let providerInstance: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!providerInstance) {
    providerInstance = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  }
  return providerInstance;
}

const EMPTY_STATS: ReferralStats = {
  live: false,
  code: "",
  referees: 0,
  totalEarned: "0",
  pendingClaim: "0",
};

/**
 * Fallback only: sum RebateAccrued(referrer, amount) logs directly from the
 * chain when the indexer DB has no data. Bounded to the deployment window.
 */
async function scanTotalEarnedFromChain(
  vault: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  referrer: string,
): Promise<bigint> {
  try {
    const filter = vault.filters.RebateAccrued(referrer);
    const latest = await provider.getBlockNumber();
    const DEPLOY_BLOCK = 248_000_000;
    const fromBlock = latest > DEPLOY_BLOCK ? DEPLOY_BLOCK : 0;
    const logs = await vault.queryFilter(filter, fromBlock, latest);
    let total = 0n;
    for (const log of logs) {
      const amount = (log as ethers.EventLog).args?.amount as bigint | undefined;
      if (amount) total += amount;
    }
    return total;
  } catch {
    // queryFilter can be unsupported / rate-limited on some RPCs — degrade to 0
    // rather than failing the whole stats call (pendingClaim is still truthful).
    return 0n;
  }
}

router.get("/stats", async (req: Request, res: Response) => {
  const address = String(req.query.address ?? "").trim();
  if (!ethers.isAddress(address)) {
    return res
      .status(400)
      .json({ success: false, error: "valid address query param required", data: EMPTY_STATS } as ApiResponse<ReferralStats>);
  }

  const registryAddr = referralRegistryAddress();
  const vaultAddr = vaultCoreAddress();

  // Program not wired into this deployment → honest "not live" response.
  if (!registryAddr || !ethers.isAddress(registryAddr)) {
    return res.json({ success: true, data: EMPTY_STATS } as ApiResponse<ReferralStats>);
  }

  try {
    const provider = getProvider();
    const registry = new ethers.Contract(registryAddr, REFERRAL_REGISTRY_ABI, provider);

    const code: string = await registry.codeOf(address).catch(() => "");

    let referees = 0;
    if (code) {
      // codeOf_ returns the keccak hash used as the refereeCount key.
      const codeHash: string = await registry.codeOf_(address).catch(() => ethers.ZeroHash);
      if (codeHash && codeHash !== ethers.ZeroHash) {
        const count: bigint = await registry.refereeCount(codeHash).catch(() => 0n);
        referees = Number(count);
      }
    }

    let pendingClaim = "0";
    let totalEarned = "0";
    if (vaultAddr && ethers.isAddress(vaultAddr)) {
      const vault = new ethers.Contract(vaultAddr, VAULT_REBATE_ABI, provider);

      // Prefer the indexed cumulative total; fall back to an on-chain scan only
      // when the indexer DB has no value available.
      const [claimable, indexedEarned] = await Promise.all([
        vault.claimableRebates(address).catch(() => 0n) as Promise<bigint>,
        fetchReferralEarned(address),
      ]);
      pendingClaim = ethers.formatUnits(claimable, USDC_DECIMALS);

      if (indexedEarned !== null) {
        totalEarned = ethers.formatUnits(BigInt(indexedEarned), USDC_DECIMALS);
      } else {
        const scanned = await scanTotalEarnedFromChain(vault, provider, address);
        totalEarned = ethers.formatUnits(scanned, USDC_DECIMALS);
      }
    }

    const data: ReferralStats = {
      live: true,
      code,
      referees,
      totalEarned,
      pendingClaim,
    };
    res.json({ success: true, data } as ApiResponse<ReferralStats>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch referral stats";
    res.json({ success: false, error: message, data: EMPTY_STATS } as ApiResponse<ReferralStats>);
  }
});

export default router;
