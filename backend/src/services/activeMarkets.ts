import { ethers } from "ethers";
import TradingCoreABI from "../abi/TradingCore.js";

const TRADING_CORE_ABI_FALLBACK = [
  "function activeMarketCount() view returns (uint256)",
  "function activeMarketAt(uint256 index) view returns (address)",
] as const;

function getTradingCoreAbi(): any[] {
  return (TradingCoreABI as any).abi ?? TradingCoreABI;
}

const CONFLUX_FALLBACK_RPCS = [
  "https://evmtestnet.confluxrpc.com",
  "https://evm.confluxrpc.com",
];

function getRpcUrls(): string[] {
  const primary = (process.env.RPC_URL ?? "").trim();
  const fallback = (process.env.RPC_FALLBACK_URL ?? "").trim();
  const urls = primary ? [primary] : [];
  if (fallback && !urls.includes(fallback)) urls.push(fallback);
  if (process.env.CHAIN_ID === "71" || process.env.CHAIN_ID === "1030" || !primary) {
    for (const u of CONFLUX_FALLBACK_RPCS) if (!urls.includes(u)) urls.push(u);
  }
  return urls;
}

async function tryFetchActiveSet(rpcUrl: string, tradingCoreAddress: string): Promise<Set<string> | null> {
  const chainId = parseInt(process.env.CHAIN_ID ?? "71", 10);
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  const contract = new ethers.Contract(tradingCoreAddress, getTradingCoreAbi(), provider);
  const count = await contract.activeMarketCount();
  const n = Number(count);
  const set = new Set<string>();
  for (let i = 0; i < n; i++) {
    const addr = await contract.activeMarketAt(i);
    if (addr && typeof addr === "string") set.add(addr.toLowerCase());
  }
  return set;
}

export async function getActiveMarketAddresses(): Promise<Set<string> | null> {
  const tradingCoreAddress = (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
  const urls = getRpcUrls();
  if (!urls.length || !tradingCoreAddress) {
    console.warn("[activeMarkets] Filter disabled: RPC_URL or TRADING_CORE_ADDRESS not set in env");
    return null;
  }

  for (const rpcUrl of urls) {
    try {
      const set = await tryFetchActiveSet(rpcUrl, tradingCoreAddress);
      if (set && set.size >= 0) return set;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (urls.indexOf(rpcUrl) < urls.length - 1) {
        console.warn("[activeMarkets] RPC failed, trying next:", rpcUrl.slice(0, 40) + "...", msg);
      } else {
        console.warn("[activeMarkets] RPC call failed (all endpoints):", msg);
      }
    }
  }
  return null;
}
