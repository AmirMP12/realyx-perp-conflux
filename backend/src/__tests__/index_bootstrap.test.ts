import { jest } from "@jest/globals";

const listenMock = jest.fn<any>();
const fakeServer = { close: jest.fn((cb?: any) => cb && cb()) };
const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const startWsMock = jest.fn<any>(() => jest.fn());
const startMetricsMock = jest.fn<any>(() => ({ close: jest.fn() }));
const runSyncMock = jest.fn<any>().mockResolvedValue({ eventsSynced: 1, scannedTo: 10 });
const startReconcileMock = jest.fn<any>(() => jest.fn());
const initCacheMock = jest.fn<any>().mockResolvedValue(undefined);

jest.mock("../config.js", () => ({
  __esModule: true,
  config: { port: 12345, metricsPort: 0, nodeEnv: "test", rpcUrl: "", chainId: 71 },
}));
jest.mock("../app.js", () => ({
  __esModule: true,
  app: { listen: (...a: any[]) => listenMock(...a) },
  logger: loggerMock,
}));
jest.mock("../wsServer.js", () => ({
  __esModule: true,
  startWsServer: (...a: any[]) => startWsMock(...a),
}));
jest.mock("../metricsServer.js", () => ({
  __esModule: true,
  startMetricsServer: (...a: any[]) => startMetricsMock(...a),
}));
jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  runSync: (...a: any[]) => runSyncMock(...a),
  checkAndSync: jest.fn(),
}));
jest.mock("../services/reconciliation.js", () => ({
  __esModule: true,
  startReconciliationLoop: (...a: any[]) => startReconcileMock(...a),
  getLastReconciliation: () => ({ ran: false }),
}));
jest.mock("../services/cache.js", () => ({
  __esModule: true,
  initCacheBackend: (...a: any[]) => initCacheMock(...a),
}));

import { bootstrap, registerShutdown, handleBootstrapError } from "../index.js";

describe("index bootstrap", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    listenMock.mockImplementation((_port: number, cb: () => void) => {
      cb();
      return fakeServer;
    });
    process.env = { ...OLD_ENV, NODE_ENV: "test" };
    delete process.env.ENABLE_WS;
    delete process.env.DISABLE_INBAND_SYNC;
    delete process.env.DISABLE_RECONCILIATION;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("wires the cache, listens, starts ws and reconciliation by default", async () => {
    process.env.RPC_URL = "https://rpc";
    process.env.TRADING_CORE_ADDRESS = "0xcore";
    const handles: any = await bootstrap();
    expect(initCacheMock).toHaveBeenCalled();
    expect(listenMock).toHaveBeenCalledWith(12345, expect.any(Function));
    expect(startWsMock).toHaveBeenCalled();
    expect(startReconcileMock).toHaveBeenCalled();
    // In-band sync loop scheduled → returns an interval handle.
    if (handles.interval) clearInterval(handles.interval);
  });

  it("warns when RPC_URL / trading core are not configured", async () => {
    delete process.env.RPC_URL;
    delete process.env.TRADING_CORE_ADDRESS;
    delete process.env.DEPLOYED_TRADING_CORE;
    const handles: any = await bootstrap();
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("RPC_URL"));
    if (handles.interval) clearInterval(handles.interval);
  });

  it("disables the WebSocket server when ENABLE_WS=false", async () => {
    process.env.ENABLE_WS = "false";
    const handles: any = await bootstrap();
    expect(startWsMock).not.toHaveBeenCalled();
    if (handles.interval) clearInterval(handles.interval);
  });

  it("skips the in-band sync loop when DISABLE_INBAND_SYNC=true", async () => {
    process.env.DISABLE_INBAND_SYNC = "true";
    const handles: any = await bootstrap();
    expect(handles.interval).toBeUndefined();
    expect(loggerMock.info).toHaveBeenCalledWith(expect.stringContaining("In-band sync disabled"));
  });

  it("skips reconciliation when DISABLE_RECONCILIATION=true", async () => {
    process.env.DISABLE_RECONCILIATION = "true";
    const handles: any = await bootstrap();
    expect(startReconcileMock).not.toHaveBeenCalled();
    if (handles.interval) clearInterval(handles.interval);
  });

  it("runs the background sync pulse and logs the result", async () => {
    jest.useFakeTimers();
    try {
      const handles: any = await bootstrap();
      expect(handles.interval).toBeDefined();
      runSyncMock.mockClear();
      await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(runSyncMock).toHaveBeenCalled();
      if (handles.interval) clearInterval(handles.interval);
    } finally {
      jest.useRealTimers();
    }
  });

  it("logs background sync failures", async () => {
    jest.useFakeTimers();
    try {
      const handles: any = await bootstrap();
      runSyncMock.mockRejectedValueOnce(new Error("sync fail"));
      await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(loggerMock.error).toHaveBeenCalled();
      if (handles.interval) clearInterval(handles.interval);
    } finally {
      jest.useRealTimers();
    }
  });

  it("starts the metrics server outside the test environment", async () => {
    process.env.NODE_ENV = "production";
    const handles: any = await bootstrap();
    expect(startMetricsMock).toHaveBeenCalled();
    if (handles.interval) clearInterval(handles.interval);
  });

  describe("registerShutdown", () => {
    let exitSpy: any;
    beforeEach(() => {
      exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as any);
    });
    afterEach(() => {
      exitSpy.mockRestore();
      process.removeAllListeners("SIGTERM");
      process.removeAllListeners("SIGINT");
    });

    it("tears down all handles and exits cleanly on SIGTERM", () => {
      jest.useFakeTimers();
      try {
        const interval = setInterval(() => {}, 1000);
        const stopWs = jest.fn();
        const stopReconcile = jest.fn();
        const metricsServer: any = { close: jest.fn() };
        const server: any = { close: jest.fn((cb: any) => cb()) };
        registerShutdown({ server, metricsServer, interval, stopWs, stopReconcile });
        process.emit("SIGTERM" as any);
        expect(stopWs).toHaveBeenCalled();
        expect(stopReconcile).toHaveBeenCalled();
        expect(metricsServer.close).toHaveBeenCalled();
        expect(server.close).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);
        // Second signal is a no-op (shuttingDown guard).
        process.emit("SIGINT" as any);
      } finally {
        jest.useRealTimers();
      }
    });

    it("exits with code 1 when server.close reports an error", () => {
      jest.useFakeTimers();
      try {
        const server: any = { close: jest.fn((cb: any) => cb(new Error("close fail"))) };
        registerShutdown({ server });
        process.emit("SIGINT" as any);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("swallows errors thrown by stopWs / stopReconcile", () => {
      jest.useFakeTimers();
      try {
        const server: any = { close: jest.fn((cb: any) => cb()) };
        const stopWs = jest.fn(() => { throw new Error("ws"); });
        const stopReconcile = jest.fn(() => { throw new Error("recon"); });
        registerShutdown({ server, stopWs, stopReconcile });
        expect(() => process.emit("SIGTERM" as any)).not.toThrow();
      } finally {
        jest.useRealTimers();
      }
    });

    it("force-exits after the failsafe timeout", () => {
      jest.useFakeTimers();
      try {
        // server.close never invokes its callback → failsafe timer fires.
        const server: any = { close: jest.fn() };
        registerShutdown({ server });
        process.emit("SIGTERM" as any);
        jest.advanceTimersByTime(10_000);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it("handleBootstrapError logs the error", () => {
    handleBootstrapError(new Error("nope"));
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
