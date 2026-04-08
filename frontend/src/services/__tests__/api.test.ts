import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, marketsApi, positionsApi, historyApi, statsApi } from '../api';

// Mock axios
vi.mock('axios', () => {
    return {
        default: {
            create: vi.fn(() => ({
                get: vi.fn(),
                post: vi.fn(),
                interceptors: {
                    request: { use: vi.fn(), eject: vi.fn() },
                    response: { use: vi.fn(), eject: vi.fn() },
                },
            })),
        },
    };
});

describe('api services', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('marketsApi', () => {
        it('getAll calls /markets', async () => {
            const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });
            await marketsApi.getAll();
            expect(spy).toHaveBeenCalledWith('/markets');
        });

        it('getById calls /markets/:id', async () => {
            const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });
            await marketsApi.getById('eth-usdc');
            expect(spy).toHaveBeenCalledWith('/markets/eth-usdc');
        });

        it('getStats calls /markets/stats', async () => {
            const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });
            await marketsApi.getStats();
            expect(spy).toHaveBeenCalledWith('/markets/stats');
        });
    });

    describe('positionsApi', () => {
        it('getByWallet calls /positions?wallet=...', async () => {
            const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });
            await positionsApi.getByWallet('0x123');
            expect(spy).toHaveBeenCalledWith('/positions?wallet=0x123');
        });

        it('open calls /positions/open with data', async () => {
            const spy = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
            const data = { market: 'eth', side: 'LONG', size: 100, margin: 10, leverage: 10 };
            await positionsApi.open(data);
            expect(spy).toHaveBeenCalledWith('/positions/open', data);
        });

        it('close calls /positions/:id/close', async () => {
            const spy = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
            await positionsApi.close(1);
            expect(spy).toHaveBeenCalledWith('/positions/1/close');
        });

        it('modifyMargin calls /positions/:id/margin', async () => {
            const spy = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
            await positionsApi.modifyMargin(1, 50);
            expect(spy).toHaveBeenCalledWith('/positions/1/margin', { amount: 50 });
        });
    });

    describe('historyApi', () => {
        it('getByWallet calls /history?wallet=...', async () => {
            const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });
            await historyApi.getByWallet('0x123');
            expect(spy).toHaveBeenCalledWith('/history?wallet=0x123');
        });
    });

    describe('statsApi', () => {
        it('getProtocol calls /stats/protocol', async () => {
            const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });
            await statsApi.getProtocol();
            expect(spy).toHaveBeenCalledWith('/stats/protocol');
        });
    });
});
