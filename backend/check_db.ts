import pg from "pg";
const { Pool } = pg;
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config();

async function check() {
  console.log('Connecting to:', process.env.POSTGRES_URL);
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const filter24h = nowEpoch - 24 * 3600;

    const resRaw = await pool.query('SELECT block_time, created_at, event_type FROM position_events ORDER BY id DESC LIMIT 5');
    console.log('Last 5 events (raw data):');
    console.table(resRaw.rows);

    const dbTimeRes = await pool.query("SELECT EXTRACT(EPOCH FROM NOW()) as now_epoch, EXTRACT(EPOCH FROM (NOW() - INTERVAL '24 hours')) as filter_epoch");
    console.log('Database time info:');
    console.table(dbTimeRes.rows);

    const statsRes = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE block_time >= $1) as count_24h,
        COUNT(*) FILTER (WHERE block_time IS NULL) as count_null,
        MIN(block_time) as min_block_time,
        MAX(block_time) as max_block_time
      FROM position_events
    `, [filter24h]);
    
    console.log('Statistics:');
    console.table(statsRes.rows);

  } catch (err) {
    console.error('Check failed:', err);
  } finally {
    await pool.end();
  }
}

check();
