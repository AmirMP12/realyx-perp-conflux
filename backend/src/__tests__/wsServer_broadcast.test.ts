import { EventEmitter } from "events";
import { jest } from "@jest/globals";

class MockWs extends EventEmitter {
  isAlive = true;
  readyState = 1;
  send = jest.fn();
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

let pythPricesImpl: any = async () => ({});
let pyth24hImpl: any = async () => 2.5;
let marketsImpl: any = async () => [];
let protocolImpl: any = async () => ({ volume24hUsd: "1000000000000000000", totalVolumeUsd: "2000000000000000000" });
let activeImpl: any = async () => new Set<string>();

jest.mock("../services/pyth.js", () => ({
  __esModule: true,
  fetchPythPrices: (...a: any[]) => pythPricesImpl(...a),
  fetchPyth24hChange: (...a: any[]) => pyth24hImpl(...a),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchMarkets: (...a: any[]) => marketsImpl(...a),
  fetchProtocol: (...a: any[]) => protocolImpl(...a),
}));
jest.mock("../services/activeMarkets.js", () => ({
  __esModule: true,
  getActiveMarketAddresses: (...a: any[]) => activeImpl(...a),
}));

import { startWsServer } from "../wsServer.js";

const ADDR = "0x986a383f6de4a24dd3f524f0f93546229b58265f";

describe("wsServer broadcast/poll path", () => {
  let cleanup: any;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.NODE_ENV = "test";
    mockWss.removeAllListeners();
    mockWss.clients.clear();
    pythPricesImpl = async () => ({ [ADDR]: 100 });
    pyth24hImpl = async () => 2.5;
    marketsImpl = async () => [
      { marketAddress: ADDR, fundingRate: (1n * 10n ** 15n).toString(), totalLongSize: "1000", totalShortSize: "500" },
    ];
    protocolImpl = async () => ({ volume24hUsd: "1000000000000000000", totalVolumeUsd: "2000000000000000000" });
    activeImpl = async () => new Set([ADDR.toLowerCase()]);
  });

  afterEach(() => {
    if (cleanup) cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("attaches to an existing HTTP server when one is supplied", () => {
    const { WebSocketServer } = require("ws") as { WebSocketServer: jest.Mock };
    WebSocketServer.mockClear();
    const fakeHttpServer = {} as any;
    cleanup = startWsServer({ server: fakeHttpServer });
    expect(WebSocketServer).toHaveBeenCalledWith({ server: fakeHttpServer });
  });

  it("broadcasts price, funding and stats updates to a subscribed client", async () => {
    cleanup = startWsServer();
    const ws = new MockWs();
    ws.channels = []; // no channel filter → receives everything
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });

    // Advance to the next poll tick so broadcastData runs with the client present.
    await jest.advanceTimersByTimeAsync(600);

    expect(ws.send).toHaveBeenCalled();
    const types = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]).type);
    expect(types).toContain("price_update");
    expect(types).toContain("funding_update");
    expect(types).toContain("stats_update");
  });

  it("broadcasts all markets when no active-set filter is present", async () => {
    activeImpl = async () => new Set<string>(); // size 0 → markets passed through unfiltered
    cleanup = startWsServer();
    const ws = new MockWs();
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    await jest.advanceTimersByTimeAsync(600);
    expect(ws.send).toHaveBeenCalled();
  });

  it("respects channel subscriptions when broadcasting", async () => {
    cleanup = startWsServer();
    const ws = new MockWs();
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    ws.emit("message", JSON.stringify({ type: "subscribe", channels: ["stats"] }));
    await jest.advanceTimersByTimeAsync(600);
    const types = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]).type);
    // Only stats channel messages should reach this client.
    expect(types).toContain("stats_update");
    expect(types).not.toContain("price_update");
  });

  it("keeps broadcasting cached data when a poll fetch fails", async () => {
    cleanup = startWsServer();
    const ws = new MockWs();
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    await jest.advanceTimersByTimeAsync(600); // first poll populates the cache
    ws.send.mockClear();
    marketsImpl = async () => { throw new Error("fetch failed"); };
    await jest.advanceTimersByTimeAsync(600); // failing poll falls back to cached data
    expect(ws.send).toHaveBeenCalled();
  });
});
