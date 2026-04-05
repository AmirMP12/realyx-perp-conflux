import { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { useWebSocket } from '../hooks/useWebSocket';
import { getHealthBaseUrl } from '../config/api';

const HAS_WS_URL = Boolean((import.meta.env.VITE_WS_URL ?? '').trim());

export function ConnectionStatus() {
  const { connected: wsConnected } = useWebSocket();
  const [apiOk, setApiOk] = useState(true);

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

  const allOk = apiOk && (!HAS_WS_URL || wsConnected);
  const partial = apiOk || (HAS_WS_URL && wsConnected);

  return (
    <div
      className={clsx(
        'hidden sm:flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-medium',
        allOk && 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
        partial && !allOk && 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
        !partial && 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
      )}
      title={
        allOk
          ? 'Connected'
          : partial
          ? `${wsConnected ? 'API' : 'Data'} unavailable`
          : 'Connection issue — Retry or check network'
      }
      aria-label={
        allOk ? 'Connection status: Connected' : partial ? 'Connection status: Partial' : 'Connection status: Offline'
      }
    >
      {allOk ? (
        <Wifi className="w-3.5 h-3.5" aria-hidden />
      ) : (
        <WifiOff className="w-3.5 h-3.5" aria-hidden />
      )}
      <span className="tabular-nums">
        {allOk ? 'Connected' : partial ? 'Partial' : 'Offline'}
      </span>
      {allOk && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
      )}
    </div>
  );
}
