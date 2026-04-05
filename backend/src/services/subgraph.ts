import { GraphQLClient, gql } from "graphql-request";
import { config } from "../config.js";

const client = new GraphQLClient(config.subgraphUrl, {
  headers: { "Content-Type": "application/json" },
});

const CACHE_TTL_MS = 30_000; // 30s cache to reduce 429 rate limits

const PROTOCOL_QUERY = gql`
  query Protocol {
    protocol(id: "1") {
      totalPositionsOpened
      totalPositionsClosed
      totalTrades
      totalVolumeUsd
      totalFeesUsd
      totalLiquidations
      tvl
    }
  }
`;

const MARKETS_QUERY = gql`
  query Markets {
    markets(first: 100) {
      id
      marketAddress
      maxLeverage
      maxPositionSize
      maxTotalExposure
      totalLongSize
      totalShortSize
      totalLongCost
      totalShortCost
      fundingRate
      cumulativeFunding
      lastFundingTime
      longOpenInterest
      shortOpenInterest
      isActive
      isListed
      updatedAt
    }
  }
`;

const USER_POSITIONS_QUERY = gql`
  query UserPositions($trader: String!) {
    positions(
      where: { trader: $trader, state: "OPEN" }
      first: 100
      orderBy: openTimestamp
      orderDirection: desc
    ) {
      id
      positionId
      tokenId
      trader { id }
      market { id marketAddress }
      isLong
      size
      entryPrice
      liquidationPrice
      stopLossPrice
      takeProfitPrice
      leverage
      collateralAmount
      state
      openTimestamp
      lastFundingTime
      blockNumber
      txHash
    }
  }
`;

const USER_TRADES_QUERY = gql`
  query UserTrades($trader: String!, $first: Int!) {
    trades(
      where: { trader: $trader }
      first: $first
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      position { positionId }
      trader { id }
      market { id }
      type
      isLong
      size
      price
      realizedPnl
      fee
      liquidator
      timestamp
      blockNumber
      txHash
    }
  }
`;

const LEADERBOARD_QUERY = gql`
  query Leaderboard($first: Int!) {
    users(first: $first, orderBy: totalVolumeUsd, orderDirection: desc) {
      id
      address
      totalTrades
      totalVolumeUsd
      totalRealizedPnl
    }
  }
`;

const BAD_DEBT_CLAIMS_QUERY = gql`
  query BadDebtClaims($first: Int!) {
    badDebtClaims(first: $first, orderBy: submittedAt, orderDirection: desc) {
      id
      claimId
      positionId
      amount
      submittedAt
      coveredAt
      blockNumber
      txHash
    }
  }
`;

const PROTOCOL_METRICS_QUERY = gql`
  query ProtocolMetrics($first: Int!, $periodType: String!) {
    protocolMetrics(first: $first, orderBy: timestamp, orderDirection: desc, where: { periodType: $periodType }) {
      id
      period
      periodType
      volumeUsd
      tradesCount
      feesUsd
      liquidationsCount
      openInterestLong
      openInterestShort
      tvl
      timestamp
    }
  }
`;

export interface SubgraphProtocol {
  totalPositionsOpened: string;
  totalPositionsClosed: string;
  totalTrades: string;
  totalVolumeUsd: string;
  totalFeesUsd: string;
  totalLiquidations: string;
  tvl: string;
}

export interface SubgraphMarket {
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

export interface SubgraphPosition {
  id: string;
  positionId: string;
  tokenId: string;
  trader: { id: string };
  market: { id: string; marketAddress: string };
  isLong: boolean;
  size: string;
  entryPrice: string;
  liquidationPrice: string;
  stopLossPrice: string;
  takeProfitPrice: string;
  leverage: string;
  collateralAmount: string;
  state: string;
  openTimestamp: string;
  lastFundingTime: string;
  blockNumber: string;
  txHash: string;
}

export interface SubgraphTrade {
  id: string;
  position: { positionId: string };
  trader: { id: string };
  market: { id: string };
  type: string;
  isLong: boolean;
  size: string;
  price: string;
  realizedPnl: string;
  fee: string;
  liquidator: string | null;
  timestamp: string;
  blockNumber: string;
  txHash: string;
}

export interface SubgraphUser {
  id: string;
  address: string;
  totalTrades: string;
  totalVolumeUsd: string;
  totalRealizedPnl: string;
}

export interface SubgraphBadDebtClaim {
  id: string;
  claimId: string;
  positionId: string;
  amount: string;
  submittedAt: string;
  coveredAt: string | null;
  blockNumber: string;
  txHash: string;
}

let marketsCache: { data: SubgraphMarket[]; at: number } | null = null;
let protocolCache: { data: SubgraphProtocol | null; at: number } | null = null;

export async function fetchProtocol(): Promise<SubgraphProtocol | null> {
  const now = Date.now();
  if (protocolCache && now - protocolCache.at < CACHE_TTL_MS) return protocolCache.data;
  try {
    const data = await client.request<{ protocol: SubgraphProtocol | null }>(PROTOCOL_QUERY);
    protocolCache = { data: data.protocol, at: now };
    return data.protocol;
  } catch (err: unknown) {
    const res = (err as { response?: { status?: number } })?.response;
    if (res?.status === 429 && protocolCache) return protocolCache.data;
    throw err;
  }
}

export async function fetchMarkets(): Promise<SubgraphMarket[]> {
  const now = Date.now();
  if (marketsCache && now - marketsCache.at < CACHE_TTL_MS) return marketsCache.data;
  try {
    const data = await client.request<{ markets: SubgraphMarket[] }>(MARKETS_QUERY);
    const list = data.markets ?? [];
    marketsCache = { data: list, at: now };
    return list;
  } catch (err: unknown) {
    const res = (err as { response?: { status?: number } })?.response;
    if (res?.status === 429 && marketsCache) return marketsCache.data;
    throw err;
  }
}

export async function fetchUserPositions(traderAddress: string): Promise<SubgraphPosition[]> {
  const trader = traderAddress.toLowerCase();
  if (!trader.startsWith("0x")) return [];
  const data = await client.request<{ positions: SubgraphPosition[] }>(USER_POSITIONS_QUERY, {
    trader,
  });
  return data.positions ?? [];
}

export async function fetchUserTrades(traderAddress: string, limit: number): Promise<SubgraphTrade[]> {
  const trader = traderAddress.toLowerCase();
  if (!trader.startsWith("0x")) return [];
  const data = await client.request<{ trades: SubgraphTrade[] }>(USER_TRADES_QUERY, {
    trader,
    first: Math.min(limit, 200),
  });
  return data.trades ?? [];
}

export async function fetchLeaderboard(limit: number): Promise<SubgraphUser[]> {
  const data = await client.request<{ users: SubgraphUser[] }>(LEADERBOARD_QUERY, {
    first: Math.min(limit, 100),
  });
  return data.users ?? [];
}

export async function fetchBadDebtClaims(limit: number): Promise<SubgraphBadDebtClaim[]> {
  const data = await client.request<{ badDebtClaims: SubgraphBadDebtClaim[] }>(
    BAD_DEBT_CLAIMS_QUERY,
    { first: Math.min(limit, 50) }
  );
  return data.badDebtClaims ?? [];
}

export interface SubgraphProtocolMetric {
  id: string;
  period: string;
  periodType: string;
  volumeUsd: string;
  tradesCount: string;
  feesUsd: string;
  liquidationsCount: string;
  openInterestLong: string;
  openInterestShort: string;
  tvl: string;
  timestamp: string;
}

export async function fetchProtocolMetrics(limit: number, periodType: string = "day"): Promise<SubgraphProtocolMetric[]> {
  try {
    const data = await client.request<{ protocolMetrics: SubgraphProtocolMetric[] }>(
      PROTOCOL_METRICS_QUERY,
      { first: Math.min(limit, 90), periodType }
    );
    const list = data.protocolMetrics ?? [];
    return list.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  } catch (err) {
    console.warn("[subgraph] ProtocolMetrics fetch failed:", err);
    return [];
  }
}
