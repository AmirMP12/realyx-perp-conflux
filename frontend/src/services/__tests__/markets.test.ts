import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMarkets, getMarket, getMarketStats, searchMarkets, getMarketPriceHistory } from '../markets';

describe('markets service', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    describe('fetchMarkets', () => {
        it('returns mapped markets on success', async () => {
            const mockMarket = {
                id: 'eth', symbol: 'ETH', name: 'Ethereum', image: 'eth.png', marketAddress: '0x123',
                category: 'CRYPTO', indexPrice: '2500.5', volume24h: '1000000', longOI: '500000', shortOI: '400000',
                fundingRate: '0.0001', isPaused: false, change24h: 5.2
            };
            
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: true, data: [mockMarket] })
            });

            const markets = await fetchMarkets();
            expect(markets).toHaveLength(1);
            expect(markets[0].name).toBe('Ethereum');
            expect(markets[0].indexPrice).toBe(2500.5);
            expect(markets[0].openInterest).toBe(900000);
        });

        it('returns empty array on failure', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: false })
            });

            const markets = await fetchMarkets();
            expect(markets).toEqual([]);
        });

        it('uses defaults and maps paused state correctly', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => ({
                    success: true,
                    data: [{
                        id: 'xau',
                        symbol: 'XAU',
                        name: 'Gold',
                        marketAddress: '0xabc',
                        indexPrice: '2000',
                        volume24h: '5000',
                        longOI: '100',
                        shortOI: '50',
                        fundingRate: '0.0002',
                        isPaused: true
                    }]
                })
            });

            const markets = await fetchMarkets();
            expect(markets[0].image).toBe('');
            expect(markets[0].category).toBe('CRYPTO');
            expect(markets[0].change24h).toBe(0);
            expect(markets[0].isActive).toBe(false);
        });

        it('returns empty array when json parsing fails', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => {
                    throw new Error('bad json');
                }
            });

            const markets = await fetchMarkets();
            expect(markets).toEqual([]);
        });
    });

    describe('getMarket', () => {
        it('finds market by id', async () => {
            const mockMarkets = [
                { id: 'eth', symbol: 'ETH', name: 'Ethereum', marketAddress: '0x123', indexPrice: '0', volume24h: '0', longOI: '0', shortOI: '0', fundingRate: '0' }
            ];
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: true, data: mockMarkets })
            });

            const market = await getMarket('eth');
            expect(market?.name).toBe('Ethereum');
        });

        it('finds market by symbol', async () => {
            const mockMarkets = [
                { id: 'eth-id', symbol: 'ETH', name: 'Ethereum', marketAddress: '0x123', indexPrice: '0', volume24h: '0', longOI: '0', shortOI: '0', fundingRate: '0' }
            ];
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: true, data: mockMarkets })
            });

            const market = await getMarket('ETH');
            expect(market?.id).toBe('eth-id');
        });

        it('finds market by address case-insensitively', async () => {
            const mockMarkets = [
                { id: 'eth-id', symbol: 'ETH', name: 'Ethereum', marketAddress: '0xAbC123', indexPrice: '0', volume24h: '0', longOI: '0', shortOI: '0', fundingRate: '0' }
            ];
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: true, data: mockMarkets })
            });

            const market = await getMarket('0xabc123');
            expect(market?.symbol).toBe('ETH');
        });

        it('returns undefined when market is not found', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: true, data: [] })
            });

            const market = await getMarket('missing');
            expect(market).toBeUndefined();
        });
    });

    describe('getMarketStats', () => {
        it('returns stats on success', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => ({
                    success: true,
                    data: { volume24h: '1000000', totalOpenInterest: '500000', totalMarkets: '10' }
                })
            });

            const stats = await getMarketStats();
            expect(stats.totalVolume).toBe(1000000);
            expect(stats.activeMarkets).toBe(10);
        });

        it('returns zeroed stats on invalid payload', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: false, data: null })
            });

            const stats = await getMarketStats();
            expect(stats).toEqual({
                totalVolume: 0,
                totalOpenInterest: 0,
                activeMarkets: 0,
                totalTrades24h: 0
            });
        });

        it('returns zeroed stats when stats json parsing fails', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => {
                    throw new Error('bad json');
                }
            });

            const stats = await getMarketStats();
            expect(stats).toEqual({
                totalVolume: 0,
                totalOpenInterest: 0,
                activeMarkets: 0,
                totalTrades24h: 0
            });
        });
    });

    describe('searchMarkets', () => {
        it('filters markets by name or symbol', async () => {
            const mockMarkets = [
                { id: 'eth', symbol: 'ETH', name: 'Ethereum', marketAddress: '0x1', indexPrice: '0', volume24h: '0', longOI: '0', shortOI: '0', fundingRate: '0' },
                { id: 'btc', symbol: 'BTC', name: 'Bitcoin', marketAddress: '0x2', indexPrice: '0', volume24h: '0', longOI: '0', shortOI: '0', fundingRate: '0' }
            ];
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: true, data: mockMarkets })
            });

            const results = await searchMarkets('eth');
            expect(results).toHaveLength(1);
            expect(results[0].symbol).toBe('ETH');
        });
    });

    describe('getMarketPriceHistory', () => {
        it('returns price history on success', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => ({
                    success: true,
                    data: [{ timestamp: 100, value: 2500 }, { timestamp: 200, value: 2510 }]
                })
            });

            const history = await getMarketPriceHistory('eth');
            expect(history).toHaveLength(2);
            expect(history[0].price).toBe(2500);
        });

        it('uses encoded market id and parsed period days', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: true, data: [] })
            });

            await getMarketPriceHistory('eth/usd', '30d');

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/markets/price-history/eth%2Fusd?days=30')
            );
        });

        it('falls back to 7 days and empty result for invalid payload', async () => {
            (global.fetch as any).mockResolvedValue({
                json: async () => ({ success: true, data: null })
            });

            const history = await getMarketPriceHistory('eth', 'bad');

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/markets/price-history/eth?days=7')
            );
            expect(history).toEqual([]);
        });
    });
});
