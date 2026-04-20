
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('backend/.env') });

async function checkDb() {
  const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    const res = await pool.query("SELECT COUNT(*) FROM position_events");
    console.log("Total events:", res.rows[0].count);

    const res2 = await pool.query("SELECT COUNT(*) FROM position_events WHERE created_at >= NOW() - INTERVAL '24 hours'");
    console.log("Events in last 24h:", res2.rows[0].count);

    const res3 = await pool.query("SELECT event_type, market_id, created_at FROM position_events ORDER BY id DESC LIMIT 5");
    console.log("Latest events:", JSON.stringify(res3.rows, null, 2));

    const res4 = await pool.query("SELECT last_synced_block FROM indexer_state");
    console.log("Sync state:", JSON.stringify(res4.rows[0], null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

checkDb();
