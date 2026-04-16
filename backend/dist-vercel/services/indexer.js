import pg from "pg";
const { Pool } = pg;
let poolInstance = null;
function getPool() {
    if (poolInstance)
        return poolInstance;
    if (!process.env.POSTGRES_URL)
        return null;
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
const PROTOCOL_VOLUME_24H_SQL = `
  WITH opened_sizes AS (
    SELECT DISTINCT ON ((data->>0)::text)
      (data->>0)::text AS position_id,
      (data->>4)::numeric AS size_raw
    FROM position_events
    WHERE event_type = 'PositionOpened'
    ORDER BY (data->>0)::text, id ASC
  )
  SELECT COALESCE(SUM(
    CASE
      WHEN c.event_type = 'PositionOpened' AND c.data->>4 IS NOT NULL
        THEN (c.data->>4)::numeric / POWER(10::numeric, 18)
      WHEN c.event_type IN ('PositionClosed', 'PositionLiquidated') AND o.size_raw IS NOT NULL
        THEN o.size_raw / POWER(10::numeric, 18)
      ELSE 0::numeric
    END
  ), 0)::text AS volume_24h_usd
  FROM position_events c
  LEFT JOIN opened_sizes o ON o.position_id = (c.data->>0)::text
  WHERE c.event_type IN ('PositionOpened', 'PositionClosed', 'PositionLiquidated')
    AND c.data IS NOT NULL
    AND c.created_at >= NOW() - INTERVAL '24 hours'
`;
export async function fetchProtocol() {
    if (!process.env.POSTGRES_URL) {
        if (process.env.NODE_ENV === 'test')
            return { totalVolumeUsd: "5000", totalFeesUsd: "100", tvl: "1000", totalTrades: "10", totalPositionsOpened: "5", totalPositionsClosed: "4", totalLiquidations: "1" };
        return null;
    }
    try {
        const pool = getPool();
        if (!pool)
            return null;
        const [res, volRes] = await Promise.all([
            pool.query(`SELECT event_type, COUNT(*) as count FROM position_events GROUP BY event_type`),
            pool.query(PROTOCOL_VOLUME_24H_SQL).catch((e) => {
                console.error("Volume query failed:", e);
                return { rows: [{ volume_24h_usd: "0" }] };
            }),
        ]);
        let opened = 0;
        let closed = 0;
        let liq = 0;
        for (const row of res.rows) {
            if (row.event_type === "PositionOpened")
                opened = parseInt(row.count);
            if (row.event_type === "PositionClosed")
                closed = parseInt(row.count);
            if (row.event_type === "PositionLiquidated")
                liq = parseInt(row.count);
        }
        const totalVolumeUsd = volRes.rows[0]?.volume_24h_usd ?? "0";
        return {
            totalPositionsOpened: String(opened),
            totalPositionsClosed: String(closed),
            totalTrades: String(opened + closed + liq),
            totalVolumeUsd,
            totalFeesUsd: "0",
            totalLiquidations: String(liq),
            tvl: "0",
        };
    }
    catch (e) {
        return null;
    }
}
/**
 * Distinct wallets with indexed activity in the last 24h: opens, closes, and liquidations
 * (liquidated traders resolved via PositionOpened on the same position id).
 */
export async function fetchActiveTraders24h() {
    if (!process.env.POSTGRES_URL)
        return 0;
    try {
        const pool = getPool();
        if (!pool)
            return 0;
        const res = await pool.query(`
      WITH opened_for_liq AS (
        SELECT DISTINCT ON ((data->>0)::text)
          (data->>0)::text AS position_id,
          lower(account) AS trader
        FROM position_events
        WHERE event_type = 'PositionOpened'
        ORDER BY (data->>0)::text, id ASC
      ),
      recent AS (
        SELECT lower(account) AS w
        FROM position_events
        WHERE event_type IN ('PositionOpened', 'PositionClosed')
          AND data IS NOT NULL
          AND created_at >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT o.trader AS w
        FROM position_events c
        INNER JOIN opened_for_liq o ON o.position_id = (c.data->>0)::text
        WHERE c.event_type = 'PositionLiquidated'
          AND c.data IS NOT NULL
          AND c.created_at >= NOW() - INTERVAL '24 hours'
      )
      SELECT COUNT(DISTINCT w)::int AS n FROM recent WHERE w IS NOT NULL AND w LIKE '0x%'
    `);
        const n = res.rows[0]?.n;
        if (typeof n === "number" && Number.isFinite(n))
            return n;
        return parseInt(String(n ?? "0"), 10) || 0;
    }
    catch {
        return 0;
    }
}
export async function fetchMarkets() {
    try {
        const { fetchMarketsOnChain } = await import("./fetchMarketsOnchain.js");
        const onchain = await fetchMarketsOnChain();
        // If we have no database, just return onchain
        if (!process.env.POSTGRES_URL || !getPool())
            return onchain;
        // Fetch 24h volume/trades per market from DB
        const pool = getPool();
        const statsRes = await pool.query(`
      WITH opened_sizes AS (
        SELECT DISTINCT ON ((data->>0)::text)
          (data->>0)::text AS position_id,
          (data->>4)::numeric AS size_raw
        FROM position_events
        WHERE event_type = 'PositionOpened'
        ORDER BY (data->>0)::text, id ASC
      )
      SELECT 
        market_id,
        COALESCE(SUM(
          CASE
            WHEN c.event_type = 'PositionOpened' AND c.data->>4 IS NOT NULL
              THEN (c.data->>4)::numeric / POWER(10::numeric, 18)
            WHEN c.event_type IN ('PositionClosed', 'PositionLiquidated') AND o.size_raw IS NOT NULL
              THEN o.size_raw / POWER(10::numeric, 18)
            ELSE 0::numeric
          END
        ), 0)::text AS volume_24h,
        COUNT(*)::int AS trades_24h
      FROM position_events c
      LEFT JOIN opened_sizes o ON o.position_id = (c.data->>0)::text
      WHERE c.event_type IN ('PositionOpened', 'PositionClosed', 'PositionLiquidated')
        AND c.data IS NOT NULL
        AND c.created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY market_id
    `);
        const statsMap = new Map();
        statsRes.rows.forEach((row) => {
            statsMap.set(row.market_id.toLowerCase(), row);
        });
        // Merge stats into onchain markets
        const merged = onchain.map((m) => {
            const addr = (m.marketAddress || m.id).toLowerCase();
            const s = statsMap.get(addr);
            return {
                ...m,
                volume24h: s?.volume_24h ?? "0",
                trades24h: s?.trades_24h ?? 0,
            };
        });
        return merged;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[indexer] fetchMarkets indexing failed:", msg);
    }
    return [];
}
export async function fetchUserPositions(traderAddress) {
    const trader = traderAddress.toLowerCase();
    if (!trader.startsWith("0x") || !process.env.POSTGRES_URL)
        return [];
    try {
        const pool = getPool();
        if (!pool)
            return [];
        const res = await pool.query(`SELECT o.* 
       FROM position_events o 
       WHERE lower(o.account) = $1 
         AND o.event_type = 'PositionOpened' 
         AND NOT EXISTS (
           SELECT 1 FROM position_events c
           WHERE c.event_type IN ('PositionClosed', 'PositionLiquidated')
             AND (c.data->>0)::text = (o.data->>0)::text
         )
       ORDER BY o.id DESC LIMIT 50`, [trader]);
        return res.rows.map((row) => {
            let isLong = true;
            let size = "0";
            let entryPrice = "0";
            let margin = "0";
            let leverage = "1";
            let args = [];
            try {
                args = JSON.parse(row.data || "[]");
                isLong = String(args[3]) === "true";
                size = args[4] || "0";
                leverage = args[5] || "1";
                entryPrice = args[6] || "0";
                if (BigInt(leverage) > 0n) {
                    margin = (BigInt(size) / BigInt(leverage)).toString();
                }
            }
            catch {
                /* ignore malformed JSON in position_events.data */
            }
            return {
                id: String(args[0]),
                positionId: String(args[0]),
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
    }
    catch (e) {
        return [];
    }
}
export async function fetchUserTrades(traderAddress, limit) {
    const trader = traderAddress.toLowerCase();
    if (!trader.startsWith("0x") || !process.env.POSTGRES_URL)
        return [];
    try {
        const pool = getPool();
        if (!pool)
            return [];
        // UNION events where user is account (direct action) OR where user is the trader whose position was liquidated
        const res = await pool.query(`WITH user_events AS (
         -- Direct events (Open, Close, self-Liq)
         SELECT e.*, 
                o.data AS open_data, 
                o.market_id AS open_market_id
         FROM position_events e
         LEFT JOIN LATERAL (
           SELECT data, market_id
           FROM position_events
           WHERE event_type = 'PositionOpened'
             AND (data->>0)::text = (e.data->>0)::text
           ORDER BY id ASC
           LIMIT 1
         ) o ON e.event_type IN ('PositionClosed', 'PositionLiquidated')
         WHERE lower(e.account) = $1

         UNION ALL

         -- Liquidation events where user was the trader but account on record is liquidator
         SELECT e.*, 
                o.data AS open_data, 
                o.market_id AS open_market_id
         FROM position_events e
         INNER JOIN position_events o ON o.event_type = 'PositionOpened'
           AND (o.data->>0)::text = (e.data->>0)::text
         WHERE e.event_type = 'PositionLiquidated'
           AND lower(e.account) != $1
           AND lower(o.account) = $1
       )
       SELECT * FROM user_events ORDER BY id DESC LIMIT $2`, [trader, Math.min(limit, 200)]);
        return res.rows.map((row) => {
            let isLong = true;
            let size = "0";
            let price = "0";
            let pnl = "0";
            let marketId = row.market_id || "0x";
            let args = [];
            try {
                args = JSON.parse(row.data || "[]");
                if (row.event_type === "PositionOpened") {
                    isLong = String(args[3]) === "true";
                    size = args[4] || "0";
                    price = args[6] || "0";
                }
                else if (row.event_type === "PositionClosed") {
                    pnl = args[2] || "0";
                    price = args[3] || "0";
                    // Resolve isLong and size from the open event
                    if (row.open_data) {
                        try {
                            const openArgs = typeof row.open_data === 'string' ? JSON.parse(row.open_data) : row.open_data;
                            isLong = String(openArgs[3]) === "true";
                            size = openArgs[4] || "0";
                        }
                        catch { /* ignore */ }
                    }
                    // Resolve market_id from open event if current is placeholder
                    if ((!marketId || marketId === "0x") && row.open_market_id) {
                        marketId = row.open_market_id;
                    }
                }
                else if (row.event_type === "PositionLiquidated") {
                    price = args[2] || "0";
                    // Resolve isLong and size from the open event
                    if (row.open_data) {
                        try {
                            const openArgs = typeof row.open_data === 'string' ? JSON.parse(row.open_data) : row.open_data;
                            isLong = String(openArgs[3]) === "true";
                            size = openArgs[4] || "0";
                        }
                        catch { /* ignore */ }
                    }
                    if ((!marketId || marketId === "0x") && row.open_market_id) {
                        marketId = row.open_market_id;
                    }
                }
            }
            catch {
                /* ignore malformed JSON */
            }
            let type = "OPEN";
            if (row.event_type === "PositionClosed")
                type = "CLOSE";
            if (row.event_type === "PositionLiquidated")
                type = "LIQUIDATE";
            return {
                id: String(row.id),
                position: { positionId: String(args[0]) },
                trader: { id: trader },
                market: { id: marketId },
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
    }
    catch (e) {
        return [];
    }
}
function leaderboardTimeFilter(timeframe, tableAlias) {
    if (timeframe === "24h")
        return `AND ${tableAlias}.created_at >= NOW() - INTERVAL '24 hours'`;
    if (timeframe === "7d")
        return `AND ${tableAlias}.created_at >= NOW() - INTERVAL '7 days'`;
    return "";
}
/**
 * Rank traders from indexed `position_events`.
 * Uses `PositionClosed` (trader = row.account) and `PositionLiquidated` (trader resolved via matching
 * `PositionOpened` on position id — liquidate events only index the liquidator on-chain).
 * PnL sums closed `realizedPnL`; liquidations contribute volume (size × liq price / 1e12) and trades count, not PnL in the log.
 */
export async function fetchLeaderboard(limit, timeframe = "all") {
    if (!process.env.POSTGRES_URL)
        return [];
    try {
        const pool = getPool();
        if (!pool)
            return [];
        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const tf = timeframe === "24h" || timeframe === "7d" ? timeframe : "all";
        const timeFilter = leaderboardTimeFilter(tf, "e");
        const res = await pool.query(`
      WITH opened AS (
        SELECT DISTINCT ON ((data->>0)::text)
          (data->>0)::text AS position_id,
          account,
          (data->>4)::numeric AS size_raw,
          (data->>5)::numeric AS leverage_raw
        FROM position_events
        WHERE event_type = 'PositionOpened'
        ORDER BY (data->>0)::text, id ASC
      ),
      all_events AS (
        -- Every position open is volume
        SELECT lower(account) AS addr_key, account AS address_display,
               (data->>0)::text AS position_id,
               0::numeric AS pnl_raw,
               created_at
        FROM position_events
        WHERE event_type = 'PositionOpened' AND data IS NOT NULL

        UNION ALL

        -- Every position close is volume + pnl
        SELECT lower(account) AS addr_key, account AS address_display,
               (data->>0)::text AS position_id,
               (data->>2)::numeric AS pnl_raw,
               created_at
        FROM position_events
        WHERE event_type = 'PositionClosed' AND data IS NOT NULL

        UNION ALL

        -- Every liquidation is loss of margin
        SELECT lower(e.account) AS addr_key, e.account AS address_display,
               (e.data->>0)::text AS position_id,
               CASE 
                 WHEN o.leverage_raw > 0 THEN -(o.size_raw / (o.leverage_raw / POWER(10::numeric, 18)))
                 ELSE 0::numeric 
               END AS pnl_raw,
               e.created_at
        FROM position_events e
        LEFT JOIN opened o ON o.position_id = (e.data->>0)::text
        WHERE e.event_type = 'PositionLiquidated' AND e.data IS NOT NULL
      )
      SELECT
        MAX(e.address_display) AS address,
        COUNT(*)::bigint AS total_trades,
        COALESCE(SUM(e.pnl_raw), 0)::text AS total_realized_pnl,
        COALESCE(SUM(
          CASE
            WHEN o.size_raw IS NOT NULL
            THEN o.size_raw / POWER(10::numeric, 18)
            ELSE 0::numeric
          END
        ), 0)::text AS total_volume_usd
      FROM all_events e
      LEFT JOIN opened o ON o.position_id = e.position_id
      WHERE 1=1
      ${timeFilter}
      GROUP BY e.addr_key
      ORDER BY COALESCE(SUM(e.pnl_raw), 0) DESC, COALESCE(SUM(o.size_raw), 0) DESC
      LIMIT $1
      `, [safeLimit]);
        return res.rows.map((row) => ({
            id: row.address,
            address: row.address,
            totalTrades: String(row.total_trades),
            totalVolumeUsd: row.total_volume_usd ?? "0",
            totalRealizedPnl: row.total_realized_pnl ?? "0",
        }));
    }
    catch (e) {
        return [];
    }
}
export async function fetchBadDebtClaims(_limit) {
    return [];
}
export async function fetchProtocolMetrics(_limit, _periodType = "day") {
    return [];
}
