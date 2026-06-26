import { jest } from "@jest/globals";

const runSyncMock = jest.fn<any>();
const startReconcileMock = jest.fn<any>(() => () => {});

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

import { pulse, loop, sleep, registerShutdown } from "../worker.js";

describe("indexer worker", () => {
  const prevPg = process.env.POSTGRES_URL;
  const prevTc = process.env.TRADING_CORE_ADDRESS;
  const prevDtc = process.env.DEPLOYED_TRADING_CORE;

  beforeEach(() => {
    runSyncMock.mockReset();
    startReconcileMock.mockClear();
  });

  afterAll(() => {
    if (prevPg === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = prevPg;
    if (prevTc === undefined) delete process.env.TRADING_CORE_ADDRESS; else process.env.TRADING_CORE_ADDRESS = prevTc;
    if (prevDtc === undefined) delete process.env.DEPLOYED_TRADING_CORE; else process.env.DEPLOYED_TRADING_CORE = prevDtc;
  });

  describe("pulse", () => {
    it("logs a skipped pulse when another sync is in progress", async () => {
      runSyncMock.mockResolvedValueOnce({ skipped: true });
      await expect(pulse()).resolves.toBeUndefined();
      expect(runSyncMock).toHaveBeenCalled();
    });

    it("logs a successful pulse with sync stats", async () => {
      runSyncMock.mockResolvedValueOnce({
        eventsSynced: 5,
        rebatesSynced: 1,
        scannedTo: 100,
        latestBlock: 110,
        reorgDepth: 0,
        isCaughtUp: false,
      });
      await expect(pulse()).resolves.toBeUndefined();
    });

    it("handles a successful pulse with missing optional fields", async () => {
      runSyncMock.mockResolvedValueOnce({});
      await expect(pulse()).resolves.toBeUndefined();
    });

    it("swallows and logs a failed pulse", async () => {
      runSyncMock.mockRejectedValueOnce(new Error("sync boom"));
      await expect(pulse()).resolves.toBeUndefined();
    });
  });

  describe("loop guards", () => {
    let exitSpy: any;

    beforeEach(() => {
      exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as any);
    });

    afterEach(() => {
      exitSpy.mockRestore();
    });

    it("exits when POSTGRES_URL is not set", async () => {
      delete process.env.POSTGRES_URL;
      await expect(loop()).rejects.toThrow("process.exit:1");
    });

    it("exits when the trading core address is not set", async () => {
      process.env.POSTGRES_URL = "postgres://test";
      delete process.env.TRADING_CORE_ADDRESS;
      delete process.env.DEPLOYED_TRADING_CORE;
      await expect(loop()).rejects.toThrow("process.exit:1");
    });
  });

  describe("loop body", () => {
    // The loop runs forever (its `stopping` flag is only flipped by signal
    // handlers registered on auto-start, which don't run under NODE_ENV=test).
    // We drive a single iteration under fake timers, then leave the loop parked
    // at its sleep timer — the dangling promise never resolves but is harmless.
    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("starts reconciliation and runs a pulse each iteration", async () => {
      jest.useFakeTimers();
      process.env.POSTGRES_URL = "postgres://test";
      process.env.TRADING_CORE_ADDRESS = "0xcore";
      delete process.env.DISABLE_RECONCILIATION;
      runSyncMock.mockResolvedValue({ skipped: false, eventsSynced: 2, scannedTo: 5 });

      const parked = loop();
      parked.catch(() => {});
      // Flush microtasks so the guards pass, reconciliation starts and one pulse runs.
      for (let i = 0; i < 6; i++) await Promise.resolve();

      expect(startReconcileMock).toHaveBeenCalled();
      expect(runSyncMock).toHaveBeenCalled();
    });

    it("respects DISABLE_RECONCILIATION", async () => {
      jest.useFakeTimers();
      process.env.POSTGRES_URL = "postgres://test";
      process.env.TRADING_CORE_ADDRESS = "0xcore";
      process.env.DISABLE_RECONCILIATION = "true";
      startReconcileMock.mockClear();
      runSyncMock.mockResolvedValue({ skipped: true });

      const parked = loop();
      parked.catch(() => {});
      for (let i = 0; i < 6; i++) await Promise.resolve();

      expect(startReconcileMock).not.toHaveBeenCalled();
      expect(runSyncMock).toHaveBeenCalled();
    });
  });

  describe("sleep", () => {
    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("resolves after the given delay", async () => {
      jest.useFakeTimers();
      let resolved = false;
      const p = sleep(1000).then(() => { resolved = true; });
      expect(resolved).toBe(false);
      await jest.advanceTimersByTimeAsync(1000);
      await p;
      expect(resolved).toBe(true);
    });
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
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("registers signal handlers that force-exit after a grace period", () => {
      jest.useFakeTimers();
      registerShutdown();
      process.emit("SIGTERM" as any);
      // A second signal is ignored thanks to the `stopping` guard.
      process.emit("SIGINT" as any);
      jest.advanceTimersByTime(8000);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });
});
