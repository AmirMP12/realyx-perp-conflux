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

// Ultimate Fetch Interceptor for GraphQL and REST
(global as any).fetch = jest.fn().mockImplementation((url: any, options: any) => {
    const urlStr = String(url);
    
    // Subgraph (POST)
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

    // Pyth (REST)
    if (urlStr.includes('benchmarks.pyth.network') || urlStr.includes('hermes')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ([{ id: "0x986a383f6de4a24dd3f524f0f93546229b58265f", price: { price: "2000000000000", expo: -8 } }])
        });
    }

    // CoinGecko (REST)
    if (urlStr.includes('coingecko')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ 
                "bitcoin": { usd: 20000, usd_24h_change: 1.5 },
                prices: [[1600000000, 20000]]
            })
        });
    }

    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({})
    });
});

// Mock rateLimit to ALWAYS PASS
jest.mock("../middleware/rateLimit.js", () => ({
    rateLimit: (req: any, res: any, next: any) => next()
}));

// Also keep standard mocks as fallback
jest.mock("../services/activeMarkets.js", () => ({
    getActiveMarketAddresses: jest.fn().mockResolvedValue(new Set(["0x986a383f6de4a24dd3f524f0f93546229b58265f"]))
}));
