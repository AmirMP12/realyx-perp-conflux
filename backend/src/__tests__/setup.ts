import { jest } from "@jest/globals";

// Global mock for ethers to prevent real RPC calls
jest.mock("ethers", () => {
    const original = jest.requireActual("ethers") as any;
    
    const mockProvider = {
        getBlockNumber: jest.fn().mockResolvedValue(1000000),
        getLogs: jest.fn().mockResolvedValue([]),
        getBlock: jest.fn().mockResolvedValue({ timestamp: Math.floor(Date.now() / 1000) }),
        getNetwork: jest.fn().mockResolvedValue({ chainId: 71, name: 'conflux-testnet' }),
        call: jest.fn().mockResolvedValue("0x"),
        estimateGas: jest.fn().mockResolvedValue(21000n),
    };

    const mockContract = {
        activeMarketCount: jest.fn().mockResolvedValue(1n),
        activeMarketAt: jest.fn().mockResolvedValue("0x986a383f6de4a24dd3f524f0f93546229b58265f"),
        getMarketInfo: jest.fn().mockResolvedValue({
            totalLongSize: "1000000",
            totalShortSize: "500000",
            maxLeverage: "30",
            isActive: true,
            isListed: true,
        }),
        getFundingState: jest.fn().mockResolvedValue({
            cumulativeFunding: "0",
            lastSettlement: "1600000000",
        }),
    };

    const ethersMock = {
        ...original.ethers,
        JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
        Contract: jest.fn().mockImplementation(() => mockContract),
        Interface: original.ethers.Interface,
        id: original.ethers.id,
    };

    return {
        ...original,
        ethers: ethersMock,
        JsonRpcProvider: ethersMock.JsonRpcProvider,
        Contract: ethersMock.Contract,
    };
});

// SILENCE ALL CONSOLE OUTPUT BY DEFAULT
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};

const mockMarket = {
    id: "0x986a383f6de4a24dd3f524f0f93546229b58265f",
    marketAddress: "0x986a383f6de4a24dd3f524f0f93546229b58265f",
    category: "CRYPTO",
    totalLongSize: "1000000",
    totalShortSize: "500000",
};

const mockProtocol = {
    id: "realyx",
    totalVolumeUsd: "5000000",
    tvl: "1000000"
};

const mockPosition = {
    id: "1",
    market: { id: "0x986a383f6de4a24dd3f524f0f93546229b58265f", marketAddress: "0x986a383f6de4a24dd3f524f0f93546229b58265f" },
    isLong: true,
    size: "1000000",
    entryPrice: "20000",
    collateralAmount: "100",
    leverage: "10",
    liquidationPrice: "18000",
    openTimestamp: "1600000000"
};

const mockTrade = {
    id: "trade1",
    position: { positionId: "1" },
    trader: { id: "0x123" },
    market: { id: "0x986a383f6de4a24dd3f524f0f93546229b58265f" },
    type: "OPEN",
    isLong: true,
    size: "1000000",
    price: "20000",
    realizedPnl: "100",
    fee: "10",
    liquidator: null,
    timestamp: "1600000000",
    blockNumber: "1000",
    txHash: "0xhash"
};

const mockUser = {
    id: "user1",
    address: "0x123",
    totalTrades: "10",
    totalVolumeUsd: "1000000",
    totalRealizedPnl: "1000"
};

const mockMetric = {
    id: "1",
    totalVolumeUsd: "1000000",
    totalFeesUsd: "1000",
    timestamp: "1600000000"
};

(global as any).fetch = jest.fn().mockImplementation((url: any, options: any) => {
    const urlStr = String(url);
    
    if (options?.method === 'POST' || urlStr.includes('subgraph')) {
        const body = options?.body ? JSON.parse(options.body) : {};
        const query = body.query || "";
        
        let data = {};
        if (query.includes("query Protocol")) data = { protocol: mockProtocol };
        if (query.includes("query Markets")) data = { markets: [mockMarket] };
        if (query.includes("query UserPositions")) data = { positions: [mockPosition] };
        if (query.includes("query UserTrades")) data = { trades: [mockTrade] };
        if (query.includes("query Leaderboard")) data = { users: [mockUser] };
        if (query.includes("query BadDebtClaims")) data = { badDebtClaims: [] };
        if (query.includes("query ProtocolMetrics")) data = { protocolMetrics: [mockMetric] };

        return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data })
        });
    }

    if (urlStr.includes('benchmarks.pyth.network') || urlStr.includes('hermes')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ([{ id: "0x986a383f6de4a24dd3f524f0f93546229b58265f", price: { price: "2000000000000", expo: -8 } }])
        });
    }

    if (urlStr.includes('coingecko')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ([
                { id: "bitcoin", symbol: "btc", current_price: 20000, price_change_percentage_24h: 1.5, total_volume: 1000000 }
            ])
        });
    }

    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({})
    });
});

// Mock pg (Postgres)
jest.mock("pg", () => {
    const mPool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      on: jest.fn(),
      end: jest.fn(),
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      }),
    };
    return {
      default: {
          Pool: jest.fn(() => mPool),
      },
      Pool: jest.fn(() => mPool),
    };
});

// DO NOT MOCK specific services here as they have their own unit tests
