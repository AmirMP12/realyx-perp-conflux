import "dotenv/config";
import pg from "pg";
const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL || "postgres://default:AhnXovS2R8zE@ep-frosty-wildflower-a41q4ncd-pooler.us-east-1.aws.neon.tech:5432/verceldb?sslmode=require"
});

async function q() {
  try {
    const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'position_events'`);
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
q();
