import express from "express";
import { ethers } from "ethers";
import crypto from "crypto";
import pg from "pg";

const router = express.Router();

/** EIP-712 typed data for "Generate API Key" signature */
const API_KEY_DOMAIN = {
  name: "RealYX",
  version: "1",
  chainId: parseInt(process.env.CHAIN_ID ?? "71", 10),
} as const;

const API_KEY_TYPES = {
  GenerateApiKey: [
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};

let poolInstance: pg.Pool | null = null;
function getPool(): pg.Pool | null {
  if (poolInstance) return poolInstance;
  if (!process.env.POSTGRES_URL) return null;
  poolInstance = new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: /^(0|false|no)$/i.test(process.env.POSTGRES_SSL ?? "") ? undefined : (process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined),
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
  });
  return poolInstance;
}

/**
 * POST /api/v1/auth/key
 * Body: { owner, signature, nonce, tier? }
 * 
 * The user signs an EIP-712 typed message `GenerateApiKey(owner, nonce)`.
 * On valid signature, we issue an opaque API key (stored as SHA-256 hash).
 */
router.post("/key", async (req: any, res: any) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: "Database not available" });
    }

    const { owner, signature, nonce, tier } = req.body;

    if (!owner || !signature || nonce === undefined) {
      return res.status(400).json({ success: false, error: "Missing owner, signature, or nonce" });
    }

    // Validate address format
    const ownerAddr = ethers.getAddress(String(owner).toLowerCase());
    const nonceBn = BigInt(nonce);

    // Verify EIP-712 signature
    let recovered: string;
    try {
      recovered = ethers.verifyTypedData(
        API_KEY_DOMAIN,
        API_KEY_TYPES,
        { owner: ownerAddr, nonce: nonceBn },
        signature
      );
    } catch {
      return res.status(400).json({ success: false, error: "Invalid signature format" });
    }

    if (recovered.toLowerCase() !== ownerAddr.toLowerCase()) {
      return res.status(401).json({ success: false, error: "Signature does not match owner" });
    }

    // One-time-use nonce. Atomically claim (owner, nonce): the unique
    // constraint means a replayed signature (same owner + nonce) hits the
    // conflict and returns no row, so a captured signature can never be used to
    // mint additional keys. Done before issuing so the grant is truly single-use.
    const claim = await pool.query(
      `INSERT INTO api_key_nonces (owner_address, nonce)
       VALUES ($1, $2)
       ON CONFLICT (owner_address, nonce) DO NOTHING
       RETURNING owner_address`,
      [ownerAddr, nonceBn.toString()]
    );
    if (claim.rowCount === 0) {
      return res.status(409).json({ success: false, error: "Nonce already used; sign with a fresh nonce" });
    }

    // Generate an opaque API key (32 bytes of randomness, hex-encoded)
    const apiKey = "realyx_" + crypto.randomBytes(32).toString("hex");
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    // Assign tier (default FREE)
    const assignedTier = (typeof tier === "string" && ["FREE", "PRO", "VIP"].includes(tier.toUpperCase()))
      ? tier.toUpperCase()
      : "FREE";

    // Upsert: replace the key for this owner (one key per owner)
    await pool.query(
      `INSERT INTO api_keys (key_hash, owner_address, tier)
       VALUES ($1, $2, $3)
       ON CONFLICT (key_hash) DO UPDATE SET owner_address = $2, tier = $3`,
      [keyHash, ownerAddr, assignedTier]
    );

    // Return the API key ONLY ONCE — the server only stores the hash
    res.json({
      success: true,
      apiKey,
      tier: assignedTier,
      owner: ownerAddr,
      message: "Store this key securely; it will not be shown again.",
    });
  } catch (error) {
    console.error("Auth key generation error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /api/v1/auth/verify
 * Headers: x-api-key: <apiKey>
 * Returns the tier and owner for a valid key.
 */
router.get("/verify", async (req: any, res: any) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: "Database not available" });
    }

    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!apiKey) {
      return res.status(401).json({ success: false, error: "Missing x-api-key header" });
    }

    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const result = await pool.query(
      `SELECT owner_address, tier, created_at FROM api_keys WHERE key_hash = $1`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Invalid API key" });
    }

    res.json({
      success: true,
      owner: result.rows[0].owner_address,
      tier: result.rows[0].tier,
      createdAt: result.rows[0].created_at,
    });
  } catch (error) {
    console.error("Auth verify error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
export { getPool };