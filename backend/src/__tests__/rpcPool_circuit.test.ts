import { withProvider, getPoolHealth, __resetRpcPool } from "../services/rpcPool.js";

/**
 * Circuit-breaker behavior for the RPC pool: an endpoint that fails past the
 * threshold trips OPEN (cooling), routing prefers healthy endpoints, and a
 * recovered endpoint closes again.
 */
describe("rpcPool circuit breaker", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    __resetRpcPool();
    delete process.env.RPC_URL;
    delete process.env.RPC_FALLBACK_URL;
    process.env.CHAIN_ID = "71";
    process.env.RPC_URLS = "https://a.example,https://b.example";
    process.env.RPC_FAILURE_THRESHOLD = "3";
    process.env.RPC_COOLDOWN_MS = "30000";
    __resetRpcPool();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    __resetRpcPool();
  });

  it("exposes a circuit state per endpoint in pool health", async () => {
    // Trigger pool construction with a successful call.
    await withProvider(async () => "ok");
    const health = getPoolHealth();
    expect(health.length).toBeGreaterThanOrEqual(2);
    for (const h of health) {
      expect(["closed", "open", "half-open"]).toContain(h.state);
    }
  });

  it("trips an endpoint OPEN after consecutive failures past the threshold", async () => {
    // Force the SAME (first-ordered) endpoint to fail every attempt by making
    // the work throw — both endpoints fail, so each accrues failures. Repeat
    // until the breaker trips.
    for (let i = 0; i < 3; i++) {
      await expect(
        withProvider(async () => {
          throw new Error("down");
        }),
      ).rejects.toThrow();
    }
    const health = getPoolHealth();
    // At least one endpoint should now be OPEN (cooling) after >= threshold fails.
    const open = health.filter((h) => h.state === "open");
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(open[0].cooling).toBe(true);
  });

  it("recovers an endpoint to CLOSED on a subsequent success", async () => {
    // Fail once (not enough to trip with threshold 3), then succeed.
    let attempt = 0;
    await withProvider(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient");
      return "ok";
    });
    const health = getPoolHealth();
    // The endpoint that ultimately succeeded must be closed with 0 failures.
    expect(health.some((h) => h.state === "closed" && h.failures === 0)).toBe(true);
  });
});
