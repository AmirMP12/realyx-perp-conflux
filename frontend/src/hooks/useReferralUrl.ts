import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

const REF_STORAGE_KEY = 'realyx_ref_code';

export function useReferralUrl() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = searchParams.get('ref') || searchParams.get('code');
  const processedRef = useRef(false);

  useEffect(() => {
    if (!ref || ref.length < 4 || processedRef.current) return;
    processedRef.current = true;
    try {
      localStorage.setItem(REF_STORAGE_KEY, ref.toUpperCase());
    } catch {
        /* localStorage unavailable */
    }
    const next = new URLSearchParams(searchParams);
    next.delete('ref');
    next.delete('code');
    setSearchParams(next, { replace: true });
  }, [ref, searchParams, setSearchParams]);

  return ref;
}

export function getStoredRefCode(): string | null {
  try {
    return localStorage.getItem(REF_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearStoredRefCode(): void {
  try {
    localStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    /* localStorage unavailable */
  }
}
