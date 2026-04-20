import { EventEmitter } from "events";
import { jest } from "@jest/globals";

// Global WS Mocks
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
    WebSocket: { OPEN: 1 }
}));

describe("WebSocket Server Comprehensive Scenarios", () => {
    jest.setTimeout(20000);
    let cleanup: any;

    beforeEach(() => {
        jest.useFakeTimers();
        mockWss.clients.clear();
        process.env.NODE_ENV = "test";
    });

    afterEach(() => {
        if (cleanup) cleanup();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("hits non-test branches (isTestEnv = false)", async () => {
        const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
        process.env.NODE_ENV = "production";
        
        // Isolate to force reload of isTestEnv
        await jest.isolateModulesAsync(async () => {
            const { startWsServer } = await import("../wsServer.js");
            cleanup = startWsServer();
            
            const client = new MockWs();
            mockWss.emit("connection", client, { socket: { remoteAddress: "1.2.3.4" } });
            expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Client connected"));
            
            client.emit("close");
            expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Client disconnected"));
        });
        infoSpy.mockRestore();
    });

    it("hits poll failure branches with cached data (96-97)", async () => {
        process.env.NODE_ENV = "production";
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        
        await jest.isolateModulesAsync(async () => {
            // Mock indexer
            const indexer = {
                fetchMarkets: jest.fn(),
                fetchProtocol: jest.fn().mockResolvedValue({ totalVolumeUsd: "100" })
            };
            jest.doMock("../services/indexer.js", () => indexer);
            
            const pyth = {
                fetchPythPrices: jest.fn().mockResolvedValue({ "0x1": 100 })
            };
            jest.doMock("../services/pyth.js", () => pyth);

            const { startWsServer } = await import("../wsServer.js");
            
            // 1. Success poll
            indexer.fetchMarkets.mockResolvedValueOnce([{ marketAddress: "0x1", totalLongSize: "0", totalShortSize: "0" }]);
            cleanup = startWsServer();
            await Promise.resolve(); // Trigger poll

            // 2. Fail poll
            indexer.fetchMarkets.mockRejectedValueOnce(new Error("Poll Fail"));
            jest.advanceTimersByTime(20000); 
            await Promise.resolve();
            await Promise.resolve(); // wait for poll catch
            
            expect(errorSpy).toHaveBeenCalled();
        });
        errorSpy.mockRestore();
    });
});
