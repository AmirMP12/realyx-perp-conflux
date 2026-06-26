import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAccount, useReadContract } from 'wagmi';
import { useAccountRisk } from '../useAccountRisk';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
    useReadContract: vi.fn(),
}));

vi.mock('../useProgram', () => ({
    TRADING_CORE_ADDRESS: '0xcore',
    TRADING_CORE_ABI: [],
}));

const E18 = 10n ** 18n;

describe('useAccountRisk', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xuser' });
    });

    it('returns safe defaults when no data', () => {
        (useReadContract as any).mockReturnValue({ data: undefined, isLoading: true });
        const { result } = renderHook(() => useAccountRisk());
        expect(result.current.healthFactor).toBe(Infinity);
        expect(result.current.hasPositions).toBe(false);
        expect(result.current.crossPositionCount).toBe(0);
        expect(result.current.loading).toBe(true);
    });

    it('decodes a named struct shape', () => {
        (useReadContract as any).mockReturnValue({
            data: {
                totalNotional: 1000n * E18,
                totalCollateral: 500n * E18,
                maintenanceMarginRequirement: 50n * E18,
                unrealizedPnL: 25n * E18,
                healthFactor: 2n * E18,
                crossPositionCount: 3n,
                liquidatable: false,
            },
            isLoading: false,
        });
        const { result } = renderHook(() => useAccountRisk());
        expect(result.current.totalNotional).toBe(1000);
        expect(result.current.totalCollateral).toBe(500);
        expect(result.current.maintenanceMargin).toBe(50);
        expect(result.current.unrealizedPnL).toBe(25);
        expect(result.current.healthFactor).toBe(2);
        expect(result.current.crossPositionCount).toBe(3);
        expect(result.current.hasPositions).toBe(true);
        expect(result.current.liquidatable).toBe(false);
    });

    it('decodes a tuple/array shape', () => {
        (useReadContract as any).mockReturnValue({
            data: [800n * E18, 400n * E18, 40n * E18, -10n * E18, 3n * E18 / 2n, 2n, true],
            isLoading: false,
        });
        const { result } = renderHook(() => useAccountRisk());
        expect(result.current.totalNotional).toBe(800);
        expect(result.current.crossPositionCount).toBe(2);
        expect(result.current.liquidatable).toBe(true);
        expect(result.current.hasPositions).toBe(true);
    });

    it('treats zero maintenance margin as infinite health', () => {
        (useReadContract as any).mockReturnValue({
            data: [0n, 0n, 0n, 0n, 0n, 0n, false],
            isLoading: false,
        });
        const { result } = renderHook(() => useAccountRisk());
        expect(result.current.healthFactor).toBe(Infinity);
        expect(result.current.hasPositions).toBe(false);
    });
});
