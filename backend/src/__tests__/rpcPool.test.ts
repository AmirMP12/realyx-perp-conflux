import { getRpcUrls, withProvider, getProvider, getPoolHealth, __resetRpcPool } from "../services/rpcPool.js";

describe("rpcPool", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    __resetRpcPool();
    delete process.env.RPC_URL;
    delete process.env.RPC_URLS;
    delete process.env.RPC_FALLBACK_URL;
    process.env.CHAIN_ID = "71";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    __resetRpcPool();
  });

  describe("getRpcUrls", () => {
    it("includes chain defaults when nothing is set (testnet)", () => {
      const urls = getRpcUrls();
      expect(urls).toContain("https://evmtestnet.confluxrpc.com");
      expect(urls.length).toBeGreaterThan(0);
    });

    it("puts RPC_URL first and dedupes", () => {
      process.env.RPC_URL = "https://primary.example";
      process.env.RPC_FALLBACK_URL = "https://primary.example"; // dup
      const urls = getRpcUrls();
      expect(urls[0]).toBe("https://primary.example");
      expect(urls.filter((u) => u === "https://primary.example")).toHaveLength(1);
    });

    it("parses a comma-separated RPC_URLS pool", () => {
      process.env.RPC_URLS = "https://a.example, https://b.example";
      const urls = getRpcUrls();
      expect(urls).toContain("https://a.example");
      expect(urls).toContain("https://b.example");
    });

    it("uses mainnet default for chain 1030", () => {
      process.env.CHAIN_ID = "1030";
      expect(getRpcUrls()).toContain("https://evm.confluxrpc.com");
    });
  });

  describe("withProvider", () => {
    it("returns the result from the first healthy provider", async () => {
      process.env.RPC_URLS = "https://a.example,https://b.example";
      __resetRpcPool();
      const result = await withProvider(async () => 42);
      expect(result).toBe(42);
    });

    it("fails over to the next endpoint when the first throws", async () => {
      process.env.RPC_URLS = "https://a.example,https://b.example";
      __resetRpcPool();
      let attempt = 0;
      const result = await withProvider(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("first down");
        return "second-ok";
      });
      expect(result).toBe("second-ok");
      expect(attempt).toBe(2);
    });

    it("throws only when every endpoint fails", async () => {
      process.env.RPC_URLS = "https://a.example,https://b.example";
      __resetRpcPool();
      await expect(
        withProvider(async () => {
          throw new Error("all down");
        }),
      ).rejects.toThrow("all down");
    });

    it("records failures in pool health and recovers on success", async () => {
      process.env.RPC_URLS = "https://a.example,https://b.example";
      __resetRpcPool();
      // Force the first-ordered endpoint to fail once, succeed on the next.
      let attempt = 0;
      await withProvider(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("transient");
        return "ok";
      });
      const health = getPoolHealth();
      // One endpoint should show a failure, the other a success (0 failures).
      const failing = health.filter((h) => h.failures > 0);
      expect(failing.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getProvider", () => {
    it("returns a provider instance", () => {
      process.env.RPC_URL = "https://primary.example";
      __resetRpcPool();
      expect(getProvider()).toBeDefined();
    });
  });
});
