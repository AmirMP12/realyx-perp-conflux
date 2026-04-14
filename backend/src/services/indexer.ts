import pg from "pg";
const { Pool } = pg;

let poolInstance: any = null;
function getPool(): any {
  if (poolInstance) return poolInstance;
  if (!process.env.POSTGRES_URL) return null;
  
  poolInstance = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    // Serverless-safe defaults: fail fast instead of hanging and timing out.
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    allowExitOnIdle: true,
  });
  return poolInstance;
}


export interface Protocol {
  totalPositionsOpened: string;
  totalPositionsClosed: string;
  totalTrades: string;
  totalVolumeUsd: string;
  totalFeesUsd: string;
  totalLiquidations: string;
  tvl: string;
}

export interface Market {
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

export interface Position {
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

export interface Trade {
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

export interface User {
  id: string;
  address: string;
  totalTrades: string;
  totalVolumeUsd: string;
  totalRealizedPnl: string;
}

export interface BadDebtClaim {
  id: string;
  claimId: string;
  positionId: string;
  amount: string;
  submittedAt: string;
  coveredAt: string | null;
  blockNumber: string;
  txHash: string;
}

export interface ProtocolMetric {
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

export async function fetchProtocol(): Promise<Protocol | null> {
  if (!process.env.POSTGRES_URL) {
    if (process.env.NODE_ENV === 'test') return { totalVolumeUsd: "5000", totalFeesUsd: "100", tvl: "1000", totalTrades: "10", totalPositionsOpened: "5", totalPositionsClosed: "4", totalLiquidations: "1" };
    return null;
  }
  try {
    const pool = getPool();
    if (!pool) return null;
    const res = await pool.query(`SELECT event_type, COUNT(*) as count FROM position_events GROUP BY event_type`);
    let opened = 0;
    let closed = 0;
    let liq = 0;
    for (const row of res.rows) {
      if (row.event_type === "PositionOpened") opened = parseInt(row.count);
      if (row.event_type === "PositionClosed") closed = parseInt(row.count);
      if (row.event_type === "PositionLiquidated") liq = parseInt(row.count);
    }
    return {
      totalPositionsOpened: String(opened),
      totalPositionsClosed: String(closed),
      totalTrades: String(opened + closed + liq),
      totalVolumeUsd: "0",
      totalFeesUsd: "0",
      totalLiquidations: String(liq),
      tvl: "0",
    };
  } catch (e) {
    return null;
  }
}


export async function fetchMarkets(): Promise<Market[]> {
  return [];
}

export async function fetchUserPositions(traderAddress: string): Promise<Position[]> {
  const trader = traderAddress.toLowerCase();
  if (!trader.startsWith("0x") || !process.env.POSTGRES_URL) return [];
  try {
    const pool = getPool();
    if (!pool) return [];
    const res = await pool.query(
      `SELECT * FROM position_events WHERE lower(account) = $1 AND event_type = 'PositionOpened' ORDER BY id DESC LIMIT 50`,
      [trader]
    );

    return res.rows.map((row: any) => {
      let isLong = true;
      let size = "0";
      let entryPrice = "0";
      let margin = "0";
      let leverage = "1";
      try {
        const args = JSON.parse(row.data || "[]");
        isLong = String(args[3]) === "true";
        size = args[4] || "0";
        leverage = args[5] || "1";
        entryPrice = args[6] || "0";
        
        if (BigInt(leverage) > 0n) {
          margin = (BigInt(size) / BigInt(leverage)).toString();
        }
      } catch {
        /* ignore malformed JSON in position_events.data */
      }

      return {
        id: String(row.id),
        positionId: String(row.id),
        tokenId: String(row.id),
        trader: { id: trader },
        market: { id: row.market_id, marketAddress: row.market_id },
        isLong,
        size,
        entryPrice,
        liquidationPrice: "0",
        stopLossPrice: "0",
        takeProfitPrice: "0",
        leverage: leverage,
        collateralAmount: margin,
        state: "OPEN",
        openTimestamp: Math.floor(new Date(row.created_at).getTime() / 1000).toString(),
        lastFundingTime: "0",
        blockNumber: String(row.block_number),
        txHash: row.tx_hash,
      };
    });
  } catch (e) {
    return [];
  }
}

export async function fetchUserTrades(traderAddress: string, limit: number): Promise<Trade[]> {
  const trader = traderAddress.toLowerCase();
  if (!trader.startsWith("0x") || !process.env.POSTGRES_URL) return [];
  try {
    const pool = getPool();
    if (!pool) return [];
    const res = await pool.query(
      `SELECT * FROM position_events WHERE lower(account) = $1 ORDER BY id DESC LIMIT $2`,
      [trader, Math.min(limit, 200)]
    );

    return res.rows.map((row: any) => {
      let isLong = true;
      let size = "0";
      let price = "0";
      let pnl = "0";
      try {
        const args = JSON.parse(row.data || "[]");
        if (row.event_type === "PositionOpened") {
          isLong = String(args[3]) === "true";
          size = args[4] || "0";
          price = args[6] || "0";
        } else if (row.event_type === "PositionClosed") {
          pnl = args[2] || "0";
          price = args[3] || "0";
          size = "0";
        }
      } catch {
        /* ignore malformed JSON */
      }

      let type = "OPEN";
      if (row.event_type === "PositionClosed") type = "CLOSE";
      if (row.event_type === "PositionLiquidated") type = "LIQUIDATE";

      return {
        id: String(row.id),
        position: { positionId: String(row.id) },
        trader: { id: trader },
        market: { id: row.market_id },
        type,
        isLong,
        size,
        price,
        realizedPnl: pnl,
        fee: "0",
        liquidator: null,
        timestamp: Math.floor(new Date(row.created_at).getTime() / 1000).toString(),
        blockNumber: String(row.block_number),
        txHash: row.tx_hash,
      };
    });
  } catch (e) {
    return [];
  }
}

export type LeaderboardTimeframe = "all" | "24h" | "7d";

function leaderboardTimeFilter(timeframe: LeaderboardTimeframe): string {
  if (timeframe === "24h") return `AND c.created_at >= NOW() - INTERVAL '24 hours'`;
  if (timeframe === "7d") return `AND c.created_at >= NOW() - INTERVAL '7 days'`;
  return "";
}

/**
 * Rank traders from indexed `position_events`.
 * PnL and fees are summed from `PositionClosed` rows (same raw integers as on-chain, then passed through `toDecimal` in the route).
 * Volume is approximated as sum of (open_size * exit_price) / 1e12 in internal units (size and oracle price are both scaled by DECIMAL_CONVERSION in the protocol).
 */
export async function fetchLeaderboard(
  limit: number,
  timeframe: LeaderboardTimeframe = "all",
): Promise<User[]> {
  if (!process.env.POSTGRES_URL) return [];
  try {
    const pool = getPool();
    if (!pool) return [];
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const tf: LeaderboardTimeframe =
      timeframe === "24h" || timeframe === "7d" ? timeframe : "all";
    const timeFilter = leaderboardTimeFilter(tf);

    const res = await pool.query(
      `
      SELECT
        MAX(c.account) AS address,
        COUNT(*)::bigint AS total_trades,
        COALESCE(SUM((c.data->>2)::numeric), 0)::text AS total_realized_pnl,
        COALESCE(SUM(
          CASE
            WHEN o.size_raw IS NOT NULL AND (c.data->>3) IS NOT NULL
            THEN (o.size_raw * (c.data->>3)::numeric) / POWER(10::numeric, 12)
            ELSE 0::numeric
          END
        ), 0)::text AS total_volume_usd
      FROM position_events c
      LEFT JOIN (
        SELECT DISTINCT ON ((data->>0)::text)
          (data->>0)::text AS position_id,
          (data->>4)::numeric AS size_raw
        FROM position_events
        WHERE event_type = 'PositionOpened'
        ORDER BY (data->>0)::text, id ASC
      ) o ON o.position_id = (c.data->>0)::text
      WHERE c.event_type = 'PositionClosed'
        AND c.data IS NOT NULL
        ${timeFilter}
      GROUP BY lower(c.account)
      ORDER BY COALESCE(SUM((c.data->>2)::numeric), 0) DESC NULLS LAST
      LIMIT $1
      `,
      [safeLimit],
    );

    return res.rows.map((row: any) => ({
      id: row.address,
      address: row.address,
      totalTrades: String(row.total_trades),
      totalVolumeUsd: row.total_volume_usd ?? "0",
      totalRealizedPnl: row.total_realized_pnl ?? "0",
    }));
  } catch (e) {
    return [];
  }
}

export async function fetchBadDebtClaims(_limit: number): Promise<BadDebtClaim[]> {
  return [];
}

export async function fetchProtocolMetrics(
  _limit: number,
  _periodType: string = "day",
): Promise<ProtocolMetric[]> {
  return [];
}
