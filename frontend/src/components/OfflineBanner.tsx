import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useWebSocket } from '../hooks/useWebSocket';
import { getHealthBaseUrl } from '../config/api';

const HAS_WS_URL = Boolean((import.meta.env.VITE_WS_URL ?? '').trim());

export function OfflineBanner() {
  const { connected: wsConnected } = useWebSocket();
  const [apiOk, setApiOk] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${getHealthBaseUrl()}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) });
        if (!cancelled) setApiOk(res.ok);
      } catch {
        if (!cancelled) setApiOk(false);
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const offline = !apiOk || (HAS_WS_URL && !wsConnected);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await fetch(`${getHealthBaseUrl()}/health`);
      window.location.reload();
    } catch {
      setRetrying(false);
    }
  };

  if (!offline) return null;

  return (
    <div
      className="sticky top-0 z-40 flex items-center justify-between gap-4 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-400 text-sm"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 shrink-0" aria-hidden />
        <span>
          {!apiOk && !wsConnected && 'Connection issue — API and live data may be delayed.'}
          {apiOk && !wsConnected && 'Live prices unavailable. Data may be delayed.'}
          {!apiOk && wsConnected && 'API unavailable. Some data may be stale.'}
        </span>
      </div>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 transition-colors disabled:opacity-60"
        aria-label="Retry connection"
      >
        <RefreshCw className={clsx('w-3.5 h-3.5', retrying && 'animate-spin')} />
        {retrying ? 'Retrying...' : 'Retry'}
      </button>
    </div>
  );
}
