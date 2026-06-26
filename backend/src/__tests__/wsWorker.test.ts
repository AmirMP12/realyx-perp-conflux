import { jest } from "@jest/globals";

// Capture the request handler passed to http.createServer so we can exercise
// the /health, /healthz and 404 branches without binding a real socket.
let capturedHandler: ((req: any, res: any) => void) | undefined;
const fakeServer: any = {
  listen: jest.fn((_port: number, cb?: () => void) => {
    cb && cb();
    return fakeServer;
  }),
  close: jest.fn((cb?: any) => cb && cb()),
};

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const stopWsMock = jest.fn();
const startWsMock = jest.fn<any>(() => stopWsMock);

jest.mock("http", () => {
  const createServer = (handler: any) => {
    capturedHandler = handler;
    return fakeServer;
  };
  return { __esModule: true, default: { createServer }, createServer };
});
jest.mock("../config.js", () => ({
  __esModule: true,
  config: { port: 54321, wsPort: 3002, nodeEnv: "test", rpcUrl: "", chainId: 71 },
}));
jest.mock("../app.js", () => ({
  __esModule: true,
  app: {},
  logger: loggerMock,
}));
jest.mock("../wsServer.js", () => ({
  __esModule: true,
  startWsServer: (...a: any[]) => startWsMock(...a),
}));

import { bootstrapWs } from "../wsWorker.js";

function makeRes() {
  return {
    writeHead: jest.fn(),
    end: jest.fn(),
  };
}

describe("wsWorker bootstrap", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedHandler = undefined;
    fakeServer.close.mockImplementation((cb?: any) => cb && cb());
    process.env = { ...OLD_ENV, NODE_ENV: "test" };
  });

  afterEach(() => {
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("attaches the broadcaster to the HTTP server and listens on $PORT", () => {
    const { server, stopWs } = bootstrapWs();
    expect(startWsMock).toHaveBeenCalledWith({ server });
    expect(fakeServer.listen).toHaveBeenCalledWith(54321, expect.any(Function));
    expect(loggerMock.info).toHaveBeenCalledWith(
      { port: 54321 },
      expect.stringContaining("WebSocket service listening")
    );
    expect(stopWs).toBe(stopWsMock);
  });

  it("serves a 200 JSON health payload on /health", () => {
    bootstrapWs();
    const res = makeRes();
    capturedHandler!({ url: "/health" }, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true, service: "ws" }));
  });

  it("serves /healthz as well", () => {
    bootstrapWs();
    const res = makeRes();
    capturedHandler!({ url: "/healthz" }, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true, service: "ws" }));
  });

  it("returns 404 for any other path", () => {
    bootstrapWs();
    const res = makeRes();
    capturedHandler!({ url: "/nope" }, res);
    expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: false, error: "not found" }));
  });

  describe("graceful shutdown", () => {
    let exitSpy: any;
    beforeEach(() => {
      exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as any);
    });
    afterEach(() => {
      exitSpy.mockRestore();
    });

    it("stops the broadcaster, closes the server and exits 0 on SIGTERM", () => {
      bootstrapWs();
      process.emit("SIGTERM" as any);
      expect(stopWsMock).toHaveBeenCalled();
      expect(fakeServer.close).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      // Second signal is a no-op (shuttingDown guard).
      stopWsMock.mockClear();
      process.emit("SIGINT" as any);
      expect(stopWsMock).not.toHaveBeenCalled();
    });

    it("exits 1 when server.close reports an error", () => {
      fakeServer.close.mockImplementation((cb: any) => cb(new Error("close fail")));
      bootstrapWs();
      process.emit("SIGINT" as any);
      expect(loggerMock.error).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("swallows errors thrown by stopWs", () => {
      startWsMock.mockReturnValueOnce(jest.fn(() => { throw new Error("ws boom"); }));
      bootstrapWs();
      expect(() => process.emit("SIGTERM" as any)).not.toThrow();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("force-exits after the failsafe timeout when close hangs", () => {
      jest.useFakeTimers();
      try {
        fakeServer.close.mockImplementation(() => {
          /* never invokes callback → failsafe timer fires */
        });
        bootstrapWs();
        process.emit("SIGTERM" as any);
        jest.advanceTimersByTime(10_000);
        expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("Forced WS shutdown"));
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it("auto-bootstraps on import when NODE_ENV is not 'test'", async () => {
    startWsMock.mockClear();
    fakeServer.listen.mockClear();
    process.env.NODE_ENV = "production";
    await jest.isolateModulesAsync(async () => {
      await import("../wsWorker.js");
    });
    expect(startWsMock).toHaveBeenCalled();
    expect(fakeServer.listen).toHaveBeenCalled();
  });
});
