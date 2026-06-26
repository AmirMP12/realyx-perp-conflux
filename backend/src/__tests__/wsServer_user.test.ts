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

import { startWsServer, broadcastToUser, broadcastKeeperFailure } from "../wsServer.js";

const USER = "0xabc0000000000000000000000000000000000001";

describe("wsServer user-channel broadcasts", () => {
  let cleanup: any;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.NODE_ENV = "test";
    mockWss.removeAllListeners();
    mockWss.clients.clear();
    cleanup = startWsServer();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    jest.useRealTimers();
  });

  function connectAndSubscribe(ws: MockWs, address = USER) {
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    ws.emit("message", JSON.stringify({ type: "subscribe:user", address }));
  }

  it("delivers a keeper-failure notification to the subscribed user's socket", () => {
    const ws = new MockWs();
    connectAndSubscribe(ws);
    broadcastKeeperFailure({ orderId: "1", traderAddress: USER, failureReason: "reverted" });
    expect(ws.send).toHaveBeenCalled();
    const payload = JSON.parse((ws.send.mock.calls[0] as any)[0]);
    expect(payload.type).toBe("KEEPER_FAILURE");
    expect(payload.data.orderId).toBe("1");
  });

  it("is a no-op when the user has no connected sockets", () => {
    expect(() => broadcastToUser("0xdead", "PING", {})).not.toThrow();
  });

  it("prunes sockets that are no longer open", () => {
    const ws = new MockWs();
    connectAndSubscribe(ws);
    ws.readyState = 3; // CLOSED
    broadcastToUser(USER, "X", { a: 1 });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("handles ping/pong application heartbeat messages", () => {
    const ws = new MockWs();
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    ws.emit("message", JSON.stringify({ type: "ping", ts: 123 }));
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining("pong"));
  });

  it("stores channel subscriptions", () => {
    const ws = new MockWs();
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    ws.emit("message", JSON.stringify({ type: "subscribe", channels: ["prices"] }));
    expect((ws as any).channels).toEqual(["prices"]);
  });

  it("ignores malformed messages", () => {
    const ws = new MockWs();
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    expect(() => ws.emit("message", "not-json")).not.toThrow();
  });

  it("cleans up user tracking on socket close", () => {
    const ws = new MockWs();
    connectAndSubscribe(ws);
    ws.emit("close");
    // After close, broadcasting to that user must not reach the closed socket.
    ws.send.mockClear();
    broadcastToUser(USER, "X", {});
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("removes a socket on error", () => {
    const ws = new MockWs();
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    expect(() => ws.emit("error", new Error("boom"))).not.toThrow();
  });

  it("swallows a send failure when delivering to a user socket", () => {
    const ws = new MockWs();
    ws.send = jest.fn(() => { throw new Error("send failed"); });
    connectAndSubscribe(ws);
    expect(() => broadcastKeeperFailure({ orderId: "9", traderAddress: USER, failureReason: "x" })).not.toThrow();
    expect(ws.send).toHaveBeenCalled();
  });

  it("defaults the client IP to 'unknown' when the socket has no remote address", () => {
    const ws = new MockWs();
    expect(() => mockWss.emit("connection", ws, { socket: {} })).not.toThrow();
  });

  it("answers a ping without an explicit ts", () => {
    const ws = new MockWs();
    mockWss.emit("connection", ws, { socket: { remoteAddress: "1.2.3.4" } });
    ws.emit("message", JSON.stringify({ type: "ping" }));
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining("pong"));
  });

  it("reuses an existing user socket set for a second subscriber", () => {
    const a = new MockWs();
    const b = new MockWs();
    connectAndSubscribe(a);
    connectAndSubscribe(b); // second subscribe → userClients.has(addr) is already true
    broadcastToUser(USER, "X", { v: 1 });
    expect(a.send).toHaveBeenCalled();
    expect(b.send).toHaveBeenCalled();
  });

  it("terminates dead clients and pings live ones on the heartbeat", () => {
    const live = new MockWs();
    const dead = new MockWs();
    mockWss.emit("connection", live, { socket: { remoteAddress: "1.1.1.1" } });
    mockWss.emit("connection", dead, { socket: { remoteAddress: "2.2.2.2" } });
    (dead as any).isAlive = false; // marked dead since last heartbeat
    jest.advanceTimersByTime(30_000); // heartbeat interval
    expect(dead.terminate).toHaveBeenCalled();
    expect(live.ping).toHaveBeenCalled();
  });
});
