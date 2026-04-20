import pg from "pg";
const { Pool } = pg;
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config();

async function repair() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    // Any block_time > now * 2 is definitely not seconds (or it's from the year 4000)
    const threshold = now * 2; 

    const checkRes = await pool.query('SELECT COUNT(*) FROM position_events WHERE block_time > $1', [threshold]);
    console.log('Events with likely millisecond block_time:', checkRes.rows[0].count);

    if (parseInt(checkRes.rows[0].count) > 0) {
      console.log('Lowering millisecond timestamps to seconds...');
      const updateRes = await pool.query('UPDATE position_events SET block_time = block_time / 1000 WHERE block_time > $1', [threshold]);
      console.log('Updated rows:', updateRes.rowCount);
    } else {
      console.log('No millisecond timestamps detected.');
    }

    // Also check for nulls
    const nullRes = await pool.query('SELECT COUNT(*) FROM position_events WHERE block_time IS NULL');
    console.log('Events with NULL block_time:', nullRes.rows[0].count);

  } catch (err) {
    console.error('Repair failed:', err);
  } finally {
    await pool.end();
  }
}

repair();
