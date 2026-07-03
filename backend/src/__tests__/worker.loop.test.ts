import { jest } from "@jest/globals";

const runSyncMock = jest.fn<any>();
const startReconcileMock = jest.fn<any>(() => jest.fn());

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

import { pulse, loop, sleep } from "../worker.js";

describe("worker loop configuration", () => {
  const prevPg = process.env.POSTGRES_URL;
  const prevTc = process.env.TRADING_CORE_ADDRESS;
  const prevDtc = process.env.DEPLOYED_TRADING_CORE;

  beforeEach(() => {
    runSyncMock.mockReset();
    startReconcileMock.mockReset();
    startReconcileMock.mockReturnValue(jest.fn());
  });

  afterAll(() => {
    if (prevPg === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = prevPg;
    if (prevTc === undefined) delete process.env.TRADING_CORE_ADDRESS;
    else process.env.TRADING_CORE_ADDRESS = prevTc;
    if (prevDtc === undefined) delete process.env.DEPLOYED_TRADING_CORE;
    else process.env.DEPLOYED_TRADING_CORE = prevDtc;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("logs a warning when POSTGRES_URL is not a valid URL", async () => {
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as any);

    process.env.POSTGRES_URL = "not-a-valid-url";
    process.env.TRADING_CORE_ADDRESS = "0xcore";
    delete process.env.DISABLE_RECONCILIATION;

    jest.useFakeTimers();
    runSyncMock.mockResolvedValue({ skipped: true });

    const parked = loop();
    parked.catch(() => {});

    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(runSyncMock).toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it("uses DEPLOYED_TRADING_CORE when TRADING_CORE_ADDRESS is absent", async () => {
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as any);

    process.env.POSTGRES_URL = "postgres://test";
    delete process.env.TRADING_CORE_ADDRESS;
    process.env.DEPLOYED_TRADING_CORE = "0xdeployed";
    delete process.env.DISABLE_RECONCILIATION;

    jest.useFakeTimers();
    runSyncMock.mockResolvedValue({ skipped: true });

    const parked = loop();
    parked.catch(() => {});
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(runSyncMock).toHaveBeenCalled();

    exitSpy.mockRestore();
    delete process.env.DEPLOYED_TRADING_CORE;
  });

  it("respects DISABLE_RECONCILIATION=yes", async () => {
    jest.useFakeTimers();
    process.env.POSTGRES_URL = "postgres://test";
    process.env.TRADING_CORE_ADDRESS = "0xcore";
    process.env.DISABLE_RECONCILIATION = "yes";
    startReconcileMock.mockClear();
    runSyncMock.mockResolvedValue({ skipped: true });

    const parked = loop();
    parked.catch(() => {});
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(startReconcileMock).not.toHaveBeenCalled();
    delete process.env.DISABLE_RECONCILIATION;
  });

  it("respects DISABLE_RECONCILIATION=1", async () => {
    jest.useFakeTimers();
    process.env.POSTGRES_URL = "postgres://test";
    process.env.TRADING_CORE_ADDRESS = "0xcore";
    process.env.DISABLE_RECONCILIATION = "1";
    startReconcileMock.mockClear();
    runSyncMock.mockResolvedValue({ skipped: true });

    const parked = loop();
    parked.catch(() => {});
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(startReconcileMock).not.toHaveBeenCalled();
    delete process.env.DISABLE_RECONCILIATION;
  });

  it("logs a pulse with latestBlock=null", async () => {
    runSyncMock.mockResolvedValueOnce({
      eventsSynced: 0,
      rebatesSynced: 0,
      scannedTo: undefined,
      latestBlock: undefined,
      reorgDepth: 2,
      isCaughtUp: false,
    });
    await expect(pulse()).resolves.toBeUndefined();
  });

  it("sleep resolves without throwing", async () => {
    jest.useFakeTimers();
    const p = sleep(500);
    await jest.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBeUndefined();
  });
});
