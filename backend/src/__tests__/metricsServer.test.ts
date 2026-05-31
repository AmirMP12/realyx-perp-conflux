import { jest } from "@jest/globals";
import { renderMetrics, setWsConnections, registry } from "../middleware/metrics.js";

describe("Prometheus metrics", () => {
  it("renders metrics in Prometheus text format", async () => {
    const { contentType, body } = await renderMetrics();
    expect(contentType).toContain("text/plain");
    expect(typeof body).toBe("string");
    // Default process metrics should always be present.
    expect(body).toContain("process_cpu_user_seconds_total");
  });

  it("exposes the http request counter", async () => {
    const { body } = await renderMetrics();
    expect(body).toContain("http_requests_total");
  });

  it("updates the websocket connections gauge", async () => {
    setWsConnections(3);
    const value = await registry.getSingleMetricAsString("ws_active_connections");
    expect(value).toContain("ws_active_connections");
    expect(value).toContain("} 3");
  });
});
