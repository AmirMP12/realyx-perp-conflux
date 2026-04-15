import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

/** Matches `indexer.Market` for `/markets` route mapping. */
export interface OnchainMarketRow {
  id: string;
  marketAddress: string;
  maxLeverage: string;
  maxPositionSize: string;
  maxTotalExposure: string;
  totalLongSize: string;
  totalShortSize: string;
  totalLongCost: string;
  totalShortCost: string;
  fundingRate: string;
  cumulativeFunding: string;
  lastFundingTime: string;
  longOpenInterest: string;
  shortOpenInterest: string;
  isActive: boolean;
  isListed: boolean;
  updatedAt: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_TESTNET_RPCS = ["https://evmtestnet.confluxrpc.com", "https://evmtestnet.confluxrpc.org"];
const DEFAULT_MAINNET_RPCS = ["https://evm.confluxrpc.com"];

function getRpcUrls(): string[] {
  const primary = (process.env.RPC_URL ?? "").trim();
  const fallbackEnv = (process.env.RPC_FALLBACK_URL ?? "").trim();
  const urls: string[] = primary ? [primary] : [];
  if (fallbackEnv && !urls.includes(fallbackEnv)) urls.push(fallbackEnv);
  const chainId = process.env.CHAIN_ID ?? "71";
  const defaults = chainId === "1030" ? DEFAULT_MAINNET_RPCS : DEFAULT_TESTNET_RPCS;
  for (const u of defaults) if (!urls.includes(u)) urls.push(u);
  return urls;
}

function loadTradingCoreAbi(): ethers.InterfaceAbi {
  const abiPath = join(__dirname, "../abi/TradingCore.json");
  return JSON.parse(readFileSync(abiPath, "utf8")) as ethers.InterfaceAbi;
}

function toStr(n: unknown): string {
  if (n == null) return "0";
  if (typeof n === "bigint") return n.toString();
  if (typeof n === "number") return Number.isFinite(n) ? String(Math.trunc(n)) : "0";
  return String(n);
}

/**
 * When Postgres markets indexer is empty, load live OI / funding / sizes from TradingCore RPC.
 * Fixes API consumers seeing volume24h / OI / funding all zero on Vercel or without DB.
 */
export async function fetchMarketsOnChain(): Promise<OnchainMarketRow[]> {
  const tradingCoreAddress = (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
  if (!tradingCoreAddress) return [];

  const chainId = parseInt(process.env.CHAIN_ID ?? "71", 10);
  const urls = getRpcUrls();
  if (urls.length === 0) return [];

  let lastErr: unknown;
  for (const rpcUrl of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
      const abi = loadTradingCoreAbi();
      const tc = new ethers.Contract(tradingCoreAddress, abi, provider);
      const countBn = await tc.activeMarketCount();
      const n = Number(countBn);
      if (!Number.isFinite(n) || n <= 0) return [];

      const out: OnchainMarketRow[] = [];
      for (let i = 0; i < n; i++) {
        const addr: string = await tc.activeMarketAt(i);
        if (!addr || typeof addr !== "string") continue;
        const info = await tc.getMarketInfo(addr);
        const fund = await tc.getFundingState(addr);
        out.push({
          id: addr.toLowerCase(),
          marketAddress: addr,
          maxLeverage: toStr(info.maxLeverage),
          maxPositionSize: toStr(info.maxPositionSize),
          maxTotalExposure: toStr(info.maxTotalExposure),
          totalLongSize: toStr(info.totalLongSize),
          totalShortSize: toStr(info.totalShortSize),
          totalLongCost: toStr(info.totalLongCost),
          totalShortCost: toStr(info.totalShortCost),
          fundingRate: toStr(fund.fundingRate),
          cumulativeFunding: toStr(fund.cumulativeFunding),
          lastFundingTime: toStr(fund.lastSettlement),
          longOpenInterest: toStr(fund.longOpenInterest),
          shortOpenInterest: toStr(fund.shortOpenInterest),
          isActive: Boolean(info.isActive),
          isListed: Boolean(info.isListed),
          updatedAt: new Date().toISOString(),
        });
      }
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn("[fetchMarketsOnChain] all RPCs failed:", lastErr instanceof Error ? lastErr.message : lastErr);
  return [];
}
