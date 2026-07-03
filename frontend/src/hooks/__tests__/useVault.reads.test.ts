import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVaultStats, useInsuranceFund } from '../useVault';
import { useAccount, useReadContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useReadContract: vi.fn(), useWriteContract: vi.fn(), usePublicClient: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(() => ({ data: undefined, isFetched: false })) }));
vi.mock('../useProgram', () => ({ VAULT_CORE_ADDRESS: '0xVault', VAULT_ABI: [], useUSDC: () => ({ address: '0xUSDC' }) }));

const E18 = 10n ** 18n;
const E6 = 10n ** 6n;

describe('useVault read hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser' });
    });

    it('useVaultStats computes all derived values when every read resolves', () => {
        (useReadContract as any).mockImplementation(({ functionName }: any) => {
            const map: Record<string, any> = {
                asset: '0xAsset',
                decimals: 6,
                totalAssets: 1000n * E18,
                lpTotalShares: 500n * E18,
                lpBalanceOf: 100n * E18,
                accumulatedFees: 5n * E6,
                getAvailableLiquidity: 200n * E6,
                paused: false,
            };
            return { data: map[functionName], isLoading: false, isSuccess: true, isFetched: true };
        });
        const { result } = renderHook(() => useVaultStats());
        expect(result.current.stats.tvl).toBe(1000);
        expect(result.current.stats.sharePrice).toBeCloseTo(2); // 1000 / 500
        expect(result.current.stats.userBalance).toBeCloseTo(200); // 100 shares * 2
        expect(result.current.stats.accumulatedFees).toBe(5);
        expect(result.current.stats.availableLiquidity).toBe(200);
        expect(result.current.stats.isPaused).toBe(false);
    });

    it('useVaultStats falls back to defaults when reads are undefined', () => {
        (useReadContract as any).mockReturnValue({ data: undefined, isLoading: false });
        const { result } = renderHook(() => useVaultStats());
        expect(result.current.stats.tvl).toBe(0);
        expect(result.current.stats.sharePrice).toBe(1);
        expect(result.current.stats.isPaused).toBe(false);
    });

    it('useInsuranceFund computes all values when reads resolve', () => {
        (useReadContract as any).mockImplementation(({ functionName }: any) => {
            const map: Record<string, any> = {
                asset: '0xAsset',
                decimals: 6,
                insuranceAssets: 100n * E6,
                getInsuranceHealthRatio: 15n * E18 / 10n, // 1.5 -> 150%
                isInsuranceHealthy: true,
                insTotalShares: 50n * E18,
                insBalanceOf: 10n * E18,
                insuranceCircuitBreakerActive: true,
            };
            return { data: map[functionName], isLoading: false };
        });
        const { result } = renderHook(() => useInsuranceFund());
        expect(result.current.insuranceAssets).toBe(100);
        expect(result.current.healthRatioPercent).toBeCloseTo(150);
        expect(result.current.isHealthy).toBe(true);
        expect(result.current.circuitBreakerActive).toBe(true);
        expect(result.current.insSharePrice).toBeCloseTo(2); // 100 / 50
        expect(result.current.userInsuranceBalance).toBeCloseTo(20); // 10 * 2
    });

    it('useInsuranceFund falls back to defaults when reads undefined', () => {
        (useReadContract as any).mockReturnValue({ data: undefined, isLoading: false });
        const { result } = renderHook(() => useInsuranceFund());
        expect(result.current.insuranceAssets).toBe(0);
        expect(result.current.insSharePrice).toBe(1);
        expect(result.current.isHealthy).toBe(false);
        expect(result.current.circuitBreakerActive).toBe(false);
    });
});
