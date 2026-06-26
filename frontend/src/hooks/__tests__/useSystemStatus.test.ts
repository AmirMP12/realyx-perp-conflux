import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { useSystemStatus } from '../useSystemStatus';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));

describe('useSystemStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    function getQueryFn() {
        renderHook(() => useSystemStatus());
        return (useQuery as any).mock.calls[0][0].queryFn;
    }

    it('maps query result to the returned shape', () => {
        const data = { status: 'operational', uptimeSeconds: 100 };
        (useQuery as any).mockReturnValue({ data, isLoading: false, error: null, refetch: vi.fn(), dataUpdatedAt: 123 });
        const { result } = renderHook(() => useSystemStatus());
        expect(result.current.status).toEqual(data);
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.updatedAt).toBe(123);
    });

    it('returns null status and surfaces error message', () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: true, error: new Error('down'), refetch: vi.fn(), dataUpdatedAt: 0 });
        const { result } = renderHook(() => useSystemStatus());
        expect(result.current.status).toBeNull();
        expect(result.current.loading).toBe(true);
        expect(result.current.error).toBe('down');
    });

    it('queryFn returns data when success', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn(), dataUpdatedAt: 0 });
        (global.fetch as any).mockResolvedValue({ json: async () => ({ success: true, data: { status: 'degraded' } }) });
        const queryFn = getQueryFn();
        await expect(queryFn()).resolves.toEqual({ status: 'degraded' });
    });

    it('queryFn returns null when unsuccessful', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn(), dataUpdatedAt: 0 });
        (global.fetch as any).mockResolvedValue({ json: async () => ({ success: false }) });
        const queryFn = getQueryFn();
        await expect(queryFn()).resolves.toBeNull();
    });

    it('queryFn returns null when json parse fails', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn(), dataUpdatedAt: 0 });
        (global.fetch as any).mockResolvedValue({ json: async () => { throw new Error('bad'); } });
        const queryFn = getQueryFn();
        await expect(queryFn()).resolves.toBeNull();
    });
});
