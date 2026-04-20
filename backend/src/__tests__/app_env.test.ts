import { jest } from "@jest/globals";

describe("App Environment Branches", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("sets log level to debug in development", async () => {
    process.env.NODE_ENV = "development";
    const { logger } = await import("../app.js");
    expect(logger.level).toBe("debug");
  });

  it("sets log level to info in production", async () => {
    process.env.NODE_ENV = "production";
    const { logger } = await import("../app.js");
    expect(logger.level).toBe("info");
  });

  it("sets log level to silent in test", async () => {
    process.env.NODE_ENV = "test";
    const { logger } = await import("../app.js");
    expect(logger.level).toBe("silent");
  });
});
