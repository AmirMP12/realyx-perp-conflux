import {
  setIndexerLag,
  recordIndexerReorg,
  recordRpcResult,
  setRpcCircuitState,
  recordKeeperLatency,
  recordKeeperFailure,
  setReconciliationDrift,
  setWsConnections,
  renderMetrics,
} from "../middleware/metrics.js";

describe("metrics recorders", () => {
  it("setIndexerLag ignores non-finite values but still bumps the timestamp", () => {
    expect(() => setIndexerLag(NaN)).not.toThrow();
    expect(() => setIndexerLag(42)).not.toThrow();
    expect(() => setIndexerLag(-5)).not.toThrow(); // clamped to 0
  });

  it("recordIndexerReorg only counts positive depths", () => {
    expect(() => recordIndexerReorg(0)).not.toThrow();
    expect(() => recordIndexerReorg(NaN)).not.toThrow();
    expect(() => recordIndexerReorg(3)).not.toThrow();
  });

  it("recordRpcResult records both outcomes", () => {
    expect(() => recordRpcResult("host.example", "success", 12)).not.toThrow();
    expect(() => recordRpcResult("host.example", "failure", 34)).not.toThrow();
  });

  it("setRpcCircuitState maps all three states", () => {
    expect(() => setRpcCircuitState("h", "closed")).not.toThrow();
    expect(() => setRpcCircuitState("h", "half-open")).not.toThrow();
    expect(() => setRpcCircuitState("h", "open")).not.toThrow();
  });

  it("recordKeeperLatency ignores negative/non-finite samples", () => {
    expect(() => recordKeeperLatency(-1)).not.toThrow();
    expect(() => recordKeeperLatency(Infinity)).not.toThrow();
    expect(() => recordKeeperLatency(2.5)).not.toThrow();
  });

  it("recordKeeperFailure increments without throwing", () => {
    expect(() => recordKeeperFailure()).not.toThrow();
  });

  it("setReconciliationDrift ignores NaN but accepts finite drift", () => {
    expect(() => setReconciliationDrift("open_interest", NaN)).not.toThrow();
    expect(() => setReconciliationDrift("tvl", 0.25)).not.toThrow();
  });

  it("exposes the recorded metrics in the registry", async () => {
    setWsConnections(2);
    const { body } = await renderMetrics();
    expect(body).toContain("realyx_rpc_requests_total");
    expect(body).toContain("realyx_keeper_failures_total");
    expect(body).toContain("realyx_reconciliation_drift_ratio");
  });
});
