import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL || "postgres://default:AhnXovS2R8zE@ep-frosty-wildflower-a41q4ncd-pooler.us-east-1.aws.neon.tech:5432/verceldb?sslmode=require"
});

async function run() {
  try {
    const res = await pool.query('SELECT event_type, COUNT(*) FROM position_events GROUP BY event_type');
    console.log("Event counts:", res.rows);

    const dataRes = await pool.query('SELECT event_type, data FROM position_events LIMIT 5');
    console.log("Sample data:", JSON.stringify(dataRes.rows, null, 2));

  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await pool.end();
  }
}

run();
