import { jest } from "@jest/globals";
import { withProvider, getProvider, getPoolHealth, getRpcUrls, __resetRpcPool } from "../services/rpcPool.js";

describe("rpcPool failover", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    __resetRpcPool();
    delete process.env.RPC_URLS;
    delete process.env.RPC_URL;
    delete process.env.RPC_FALLBACK_URL;
    process.env.CHAIN_ID = "71";
    process.env.RPC_FAILURE_THRESHOLD = "2";
    process.env.RPC_COOLDOWN_MS = "1000";
  });

  afterEach(() => {
    process.env = { ...OLD };
    __resetRpcPool();
  });

  it("builds the url list from RPC_URLS, RPC_URL, fallback and defaults (deduped)", () => {
    process.env.RPC_URLS = "https://a.example, https://b.example";
    process.env.RPC_URL = "https://a.example"; // duplicate, should be deduped
    process.env.RPC_FALLBACK_URL = "https://c.example";
    const urls = getRpcUrls();
    expect(urls).toContain("https://a.example");
    expect(urls).toContain("https://b.example");
    expect(urls).toContain("https://c.example");
    expect(urls.filter((u) => u === "https://a.example")).toHaveLength(1);
  });

  it("uses mainnet defaults for chain 1030", () => {
    process.env.CHAIN_ID = "1030";
    expect(getRpcUrls()).toContain("https://evm.confluxrpc.com");
  });

  it("tolerates an invalid URL when building the pool (host => 'invalid')", () => {
    process.env.RPC_URLS = "::not-a-valid-url::";
    const health = getPoolHealth(); // builds from urls without constructing providers
    expect(health.some((h) => h.url === "::not-a-valid-url::")).toBe(true);
    // Force pool construction so hostOf runs on the bad URL.
    expect(() => getProvider()).not.toThrow();
  });

  it("returns the result from the first healthy provider", async () => {
    process.env.RPC_URLS = "https://a.example,https://b.example";
    const result = await withProvider(async () => "ok");
    expect(result).toBe("ok");
  });

  it("fails over to the next provider when the first throws", async () => {
    process.env.RPC_URLS = "https://a.example,https://b.example";
    let calls = 0;
    const result = await withProvider(async () => {
      calls += 1;
      if (calls === 1) throw new Error("first down");
      return "second";
    });
    expect(result).toBe("second");
    expect(calls).toBe(2);
  });

  it("throws the last error when every provider fails", async () => {
    process.env.RPC_URLS = "https://a.example,https://b.example";
    await expect(withProvider(async () => { throw new Error("all down"); })).rejects.toThrow("all down");
  });

  it("opens the circuit after the failure threshold and reports cooling", async () => {
    await jest.isolateModulesAsync(async () => {
      process.env.RPC_FAILURE_THRESHOLD = "2";
      process.env.RPC_URLS = "https://only.example";
      const pool = await import("../services/rpcPool.js");
      await expect(pool.withProvider(async () => { throw new Error("x"); })).rejects.toThrow();
      await expect(pool.withProvider(async () => { throw new Error("x"); })).rejects.toThrow();
      const health = pool.getPoolHealth();
      expect(health[0].cooling).toBe(true);
      expect(health[0].state).toBe("open");
    });
  });

  it("half-opens after cooldown and closes again on success", async () => {
    await jest.isolateModulesAsync(async () => {
      process.env.RPC_FAILURE_THRESHOLD = "1";
      process.env.RPC_COOLDOWN_MS = "1";
      process.env.RPC_URLS = "https://only.example";
      const pool = await import("../services/rpcPool.js");
      await expect(pool.withProvider(async () => { throw new Error("x"); })).rejects.toThrow();
      expect(pool.getPoolHealth()[0].state).toBe("open");
      await new Promise((r) => setTimeout(r, 20)); // let the 1ms cooldown elapse
      const ok = await pool.withProvider(async () => "recovered");
      expect(ok).toBe("recovered");
      expect(pool.getPoolHealth()[0].state).toBe("closed");
    });
  });
});
