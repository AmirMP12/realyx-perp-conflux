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
      className="px-3 sm:px-5 lg:px-8 pt-3"
      role="alert"
      aria-live="polite"
    >
      <div className="max-w-[1760px] mx-auto flex items-center justify-between gap-3 sm:gap-4 px-3 sm:px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm shadow-[0_6px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15">
            <WifiOff className="w-4 h-4" aria-hidden />
          </span>
          <span className="truncate">
            {!apiOk && !wsConnected && 'Connection issue — API and live data may be delayed.'}
            {apiOk && !wsConnected && 'Live prices unavailable. Data may be delayed.'}
            {!apiOk && wsConnected && 'API unavailable. Some data may be stale.'}
          </span>
        </div>
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-amber-500/20 hover:bg-amber-500/30 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
          aria-label="Retry connection"
        >
          <RefreshCw className={clsx('w-3.5 h-3.5', retrying && 'animate-spin')} />
          <span className="hidden sm:inline">{retrying ? 'Retrying...' : 'Retry'}</span>
        </button>
      </div>
    </div>
  );
}
