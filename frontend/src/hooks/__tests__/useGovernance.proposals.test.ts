import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGovernance } from '../useGovernance';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));

describe('useGovernance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('when wallet not connected', () => {
        beforeEach(() => {
            (useAccount as any).mockReturnValue({ address: undefined });
        });

        it('createProposal returns null and warns', async () => {
            const { result } = renderHook(() => useGovernance());
            let res;
            await act(async () => { res = await result.current.createProposal({ type: 'EmergencyPause' }, 'x'); });
            expect(res).toBeNull();
            expect(toast.error).toHaveBeenCalledWith('Please connect your wallet');
        });

        it('approveProposal returns false', async () => {
            const { result } = renderHook(() => useGovernance());
            let res;
            await act(async () => { res = await result.current.approveProposal(1); });
            expect(res).toBe(false);
        });

        it('executeProposal returns false', async () => {
            const { result } = renderHook(() => useGovernance());
            let res;
            await act(async () => { res = await result.current.executeProposal(1); });
            expect(res).toBe(false);
        });

        it('emergencyPause returns false', async () => {
            const { result } = renderHook(() => useGovernance());
            let res;
            await act(async () => { res = await result.current.emergencyPause(); });
            expect(res).toBe(false);
        });

        it('proposeAddMarket / proposeUpdateFee / proposeUpdateSigners return null', async () => {
            const { result } = renderHook(() => useGovernance());
            let a, b, c;
            await act(async () => {
                a = await result.current.proposeAddMarket(
                    { collectionId: 'c', name: 'n', maxLeverage: 10, initialMarginBps: 100, maintenanceMarginBps: 50 },
                    'desc',
                );
                b = await result.current.proposeUpdateFee(10, 'desc');
                c = await result.current.proposeUpdateSigners(['0x1'], 1, 'desc');
            });
            expect(a).toBeNull();
            expect(b).toBeNull();
            expect(c).toBeNull();
        });
    });

    describe('when connected', () => {
        beforeEach(() => {
            (useAccount as any).mockReturnValue({ address: '0xUser' });
            vi.useFakeTimers();
        });

        it('createProposal resolves with a demo signature', async () => {
            const { result } = renderHook(() => useGovernance());
            let promise: Promise<string | null>;
            act(() => { promise = result.current.createProposal({ type: 'EmergencyPause' }, 'desc'); });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            await expect(promise!).resolves.toBe('demo-tx-signature');
            expect(toast.success).toHaveBeenCalledWith('Proposal created successfully!', expect.anything());
        });

        it('approveProposal resolves true', async () => {
            const { result } = renderHook(() => useGovernance());
            let promise: Promise<boolean>;
            act(() => { promise = result.current.approveProposal(1); });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            await expect(promise!).resolves.toBe(true);
        });

        it('executeProposal resolves true', async () => {
            const { result } = renderHook(() => useGovernance());
            let promise: Promise<boolean>;
            act(() => { promise = result.current.executeProposal(1); });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            await expect(promise!).resolves.toBe(true);
        });

        it('emergencyPause resolves true', async () => {
            const { result } = renderHook(() => useGovernance());
            let promise: Promise<boolean>;
            act(() => { promise = result.current.emergencyPause(); });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            await expect(promise!).resolves.toBe(true);
        });
    });
});
