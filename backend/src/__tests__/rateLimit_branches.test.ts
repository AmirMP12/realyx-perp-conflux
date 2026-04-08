import { jest } from "@jest/globals";

describe("rateLimit branch coverage", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  it("resets request window after expiry", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const { apiRateLimit } = await import("../middleware/rateLimit.js");

    const next = jest.fn();
    apiRateLimit({ ip: "2.2.2.2" }, {}, next);
    expect(next).toHaveBeenCalledWith();

    jest.setSystemTime(61_000);
    const nextAfterWindow = jest.fn();
    apiRateLimit({ ip: "2.2.2.2" }, {}, nextAfterWindow);
    expect(nextAfterWindow).toHaveBeenCalledWith();
  });

  it("falls back to unknown client ip", async () => {
    const { apiRateLimit } = await import("../middleware/rateLimit.js");
    const next = jest.fn();
    apiRateLimit({}, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("cleans up expired entries via interval", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const { apiRateLimit } = await import("../middleware/rateLimit.js");

    for (let i = 0; i < 100; i++) {
      apiRateLimit({ ip: "9.9.9.9" }, {}, jest.fn());
    }

    jest.setSystemTime(95_000);
    jest.advanceTimersByTime(95_000);

    const next = jest.fn();
    apiRateLimit({ ip: "9.9.9.9" }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});
