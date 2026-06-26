import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGovernance } from '../useGovernance';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }));

describe('useGovernance error handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (toast.loading as any).mockReset();
        (toast.success as any).mockReset();
        (toast.error as any).mockReset();
        (useAccount as any).mockReturnValue({ address: '0xUser' });
    });

    it('createProposal hits the catch and uses error.message', async () => {
        (toast.success as any).mockImplementation(() => { throw new Error('create boom'); });
        const { result } = renderHook(() => useGovernance());
        let res: any;
        await act(async () => { res = await result.current.createProposal({ type: 'EmergencyPause' }, 'd'); });
        expect(res).toBeNull();
        expect(toast.error).toHaveBeenCalledWith('create boom', expect.anything());
    });

    it('approveProposal hits the catch with the default message', async () => {
        (toast.success as any).mockImplementation(() => { throw {}; });
        const { result } = renderHook(() => useGovernance());
        let ok: any;
        await act(async () => { ok = await result.current.approveProposal(1); });
        expect(ok).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Failed to approve proposal', expect.anything());
    });

    it('executeProposal hits the catch', async () => {
        (toast.success as any).mockImplementation(() => { throw new Error('exec boom'); });
        const { result } = renderHook(() => useGovernance());
        let ok: any;
        await act(async () => { ok = await result.current.executeProposal(2); });
        expect(ok).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('exec boom', expect.anything());
    });

    it('emergencyPause hits the catch with default message', async () => {
        (toast.success as any).mockImplementation(() => { throw {}; });
        const { result } = renderHook(() => useGovernance());
        let ok: any;
        await act(async () => { ok = await result.current.emergencyPause(); });
        expect(ok).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Failed to pause', expect.anything());
    });

    it('proposeAddMarket / proposeUpdateFee / proposeUpdateSigners delegate to createProposal', async () => {
        const { result } = renderHook(() => useGovernance());
        let a: any, b: any, c: any;
        await act(async () => {
            a = await result.current.proposeAddMarket({ collectionId: 'c', name: 'n', maxLeverage: 10, initialMarginBps: 100, maintenanceMarginBps: 50 }, 'd');
            b = await result.current.proposeUpdateFee(5, 'd');
            c = await result.current.proposeUpdateSigners(['0x1'], 1, 'd');
        });
        expect(a).toBe('demo-tx-signature');
        expect(b).toBe('demo-tx-signature');
        expect(c).toBe('demo-tx-signature');
    });

    it('returns early when wallet is not connected', async () => {
        (useAccount as any).mockReturnValue({ address: undefined });
        const { result } = renderHook(() => useGovernance());
        let r: any;
        await act(async () => {
            r = await result.current.createProposal({ type: 'EmergencyPause' }, 'd');
            await result.current.approveProposal(1);
            await result.current.executeProposal(1);
            await result.current.emergencyPause();
        });
        expect(r).toBeNull();
        expect(toast.error).toHaveBeenCalledWith('Please connect your wallet');
    });
});
