import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReferralUrl, getStoredRefCode, clearStoredRefCode } from '../useReferralUrl';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter initialEntries={['/?ref=ALICE']} future={routerFuture}>
    {children}
  </MemoryRouter>
);

describe('useReferralUrl', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('stores referral code and cleans up URL', async () => {
    renderHook(() => useReferralUrl(), { wrapper });
    
    await waitFor(() => {
        expect(localStorage.getItem('realyx_ref_code')).toBe('ALICE');
    }, { timeout: 5000 });
  });

  it('handles "code" query parameter as well', async () => {
    const wrapperBob = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={['/?code=BOBBY']} future={routerFuture}>
        {children}
      </MemoryRouter>
    );
    renderHook(() => useReferralUrl(), { wrapper: wrapperBob });
    
    await waitFor(() => {
        expect(localStorage.getItem('realyx_ref_code')).toBe('BOBBY');
    }, { timeout: 5000 });
  });

  it('returns stored code using helper', () => {
    localStorage.setItem('realyx_ref_code', 'TEST');
    expect(getStoredRefCode()).toBe('TEST');
  });

  it('clears stored code using helper', () => {
    localStorage.setItem('realyx_ref_code', 'TEST');
    clearStoredRefCode();
    expect(localStorage.getItem('realyx_ref_code')).toBeNull();
  });
});
