import pg from "pg";
const pool = new pg.Pool({
    connectionString: "postgres://default:AhnXovS2R8zE@ep-frosty-wildflower-a41q4ncd-pooler.us-east-1.aws.neon.tech:5432/verceldb?sslmode=require"
});

async function q() {
  try {
    const res = await pool.query(`SELECT COUNT(*) FROM position_events`);
    console.log("Total events in DB:", res.rows[0]);
    
    const vols = await pool.query(`SELECT event_type, COUNT(*) FROM position_events WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY event_type`);
    console.log("Last 24h events:", vols.rows);

    const leader = await pool.query(`
        SELECT account, SUM((data->>2)::numeric) as pnl 
        FROM position_events 
        WHERE event_type = 'PositionClosed' AND data IS NOT NULL 
        GROUP BY account 
        ORDER BY pnl DESC LIMIT 3
    `);
    console.log("Top 3 Pnl:", leader.rows);

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
q();
