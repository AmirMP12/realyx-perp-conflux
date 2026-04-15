export interface BackendMarket {
  id: string;
  name: string;
  symbol: string;
  image: string;
  marketAddress: string;
  /** Asset category for filter recognition */
  category?: "CRYPTO" | "STOCK" | "COMMODITY" | "FOREX";
  indexPrice: string;
  lastPrice: string;
  volume24h: string;
  longOI: string;
  shortOI: string;
  fundingRate: string;
  maxLeverage: number;
  isPaused: boolean;
  /** 24h price change percentage from CoinGecko (optional) */
  change24h?: number;
}

export interface BackendPosition {
  id: number;
  market: {
    id: string;
    name: string;
    symbol: string;
    collectionName: string;
    collectionImage: string;
  };
  side: "LONG" | "SHORT";
  size: string;
  entryPrice: string;
  margin: string;
  leverage: number;
  unrealizedPnl: string;
  realizedPnl: string;
  liquidationPrice: string;
  breakEvenPrice: string;
  openTs: string;
}

export interface TradeHistoryItem {
  id: number;
  signature: string;
  market: string;
  side: "LONG" | "SHORT";
  size: string;
  price: string;
  leverage: number;
  fee: string;
  pnl: string | null;
  type: "OPEN" | "CLOSE" | "LIQUIDATED";
  timestamp: string;
}

export interface ProtocolStats {
  totalMarkets: number;
  volume24h: string;
  totalOpenInterest: string;
  /** Distinct wallets with indexed opens/closes/liquidations in the last 24 hours */
  activeTraders24h?: number;
}

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  pnl: string;
  volume: string;
  trades: number;
}

export interface DailyStat {
  date: string;
  volume: string;
  trades: number;
  fees: string;
  pnl: string;
}

export interface InsuranceClaim {
  id: string;
  claimId: string;
  positionId: string;
  amount: string;
  amountUsd: string;
  submittedAt: string;
  coveredAt: string | null;
  txHash: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
