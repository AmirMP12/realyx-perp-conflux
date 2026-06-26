import { EventEmitter } from "events";
import { jest } from "@jest/globals";

// Exercise the `!isTestEnv` logging branches (connect/disconnect/listening +
// the send-error catch) that the test-env suites intentionally skip. We force a
// non-test NODE_ENV before the module is imported so `isTestEnv` is false.

class MockWs extends EventEmitter {
  isAlive = true;
  readyState = 1;
  send = jest.fn(() => {
    throw new Error("send boom");
  });
  terminate = jest.fn();
  ping = jest.fn();
  channels: string[] = [];
}
class MockWss extends EventEmitter {
  clients = new Set<any>();
  close = jest.fn();
}
const mockWss = new MockWss();

jest.mock("ws", () => ({
  WebSocketServer: jest.fn().mockImplementation(() => mockWss),
  WebSocket: { OPEN: 1 },
}));

const ADDR = "0x986a383f6de4a24dd3f524f0f93546229b58265f";

jest.mock("../services/pyth.js", () => ({
  __esModule: true,
  fetchPythPrices: jest.fn(async () => ({ [ADDR]: 100 })),
  fetchPyth24hChange: jest.fn(async () => 2.5),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchMarkets: jest.fn(async () => [
    { marketAddress: ADDR, fundingRate: (10n ** 15n).toString(), totalLongSize: "1000", totalShortSize: "500" },
  ]),
  fetchProtocol: jest.fn(async () => ({ volume24hUsd: "1", totalVolumeUsd: "2" })),
}));
jest.mock("../services/activeMarkets.js", () => ({
  __esModule: true,
  getActiveMarketAddresses: jest.fn(async () => new Set([ADDR.toLowerCase()])),
}));

describe("wsServer non-test logging branches", () => {
  let cleanup: (() => void) | undefined;
  let infoSpy: any;
  let errorSpy: any;
  const OLD_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    mockWss.removeAllListeners();
    mockWss.clients.clear();
    infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = undefined;
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.NODE_ENV = OLD_ENV;
  });

  it("logs lifecycle events and swallows send errors during broadcast", async () => {
    const { startWsServer } = await import("../wsServer.js");
    cleanup = startWsServer();

    // "[ws] Server listening" path executed on startup (port branch).
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Server listening"));

    const ws = new MockWs();
    ws.channels = [];
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Client connected"));

    // Let the initial poll() resolve and broadcast to our throwing client.
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
    expect(ws.send).toHaveBeenCalled();
    // send throws → catch logs via console.error (non-test branch).
    expect(errorSpy).toHaveBeenCalledWith("[ws] send error:", expect.any(Error));

    // Disconnect logging.
    ws.emit("close");
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Client disconnected"));
  });

  it("reports the attach-to-server listening branch", async () => {
    const { startWsServer } = await import("../wsServer.js");
    cleanup = startWsServer({ server: {} as any });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("attached to HTTP server")
    );
  });
});
