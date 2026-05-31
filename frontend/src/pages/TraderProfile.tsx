import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Users,
  Award,
  Activity,
  BarChart2,
  ExternalLink,
  Copy,
} from 'lucide-react';
import clsx from 'clsx';
import { getApiBaseUrl } from '../config/api';
import { formatCompact, safeUsd, truncateAddress } from '../utils/format';
import { Skeleton } from '../components/ui';
import { CopyModal } from '../components/CopyModal';

const API_BASE = getApiBaseUrl();

interface TraderProfileData {
  address: string;
  profitFeeBps: number;
  metadataURI: string;
  activeFollowers: number;
  totalPnl: string;
  roi: number;
  winRate: number;
  totalTrades: number;
  openPositions: {
    market: string;
    isLong: boolean;
    size: string;
    leverage: string;
    entryPrice: string;
    pnl: string;
  }[];
}

// Environment-aware contract addresses
const CONTRACT_ADDRESSES = {
  usdc: import.meta.env.VITE_USDC_ADDRESS || '0x0000000000000000000000000000000000000000',
  tradingCore: import.meta.env.VITE_TRADING_CORE_ADDRESS || '0x0000000000000000000000000000000000000000',
  copyRegistry: import.meta.env.VITE_COPY_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000',
  copyBot: import.meta.env.VITE_COPY_BOT_ADDRESS || '0x0000000000000000000000000000000000000000',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
/** Copy trading can only run when both the on-chain registry and the bot EOA are configured. */
const COPY_TRADING_ENABLED =
  CONTRACT_ADDRESSES.copyRegistry !== ZERO_ADDRESS && CONTRACT_ADDRESSES.copyBot !== ZERO_ADDRESS;

export function TraderProfilePage() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [trader, setTrader] = useState<TraderProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    async function fetchTrader() {
      setLoading(true);
      setError(null);
      try {
        // API_BASE already ends in `/api` (see getApiBaseUrl); social router is mounted at /api/v1/social.
        const res = await fetch(`${API_BASE}/v1/social/trader/${address}`);
        if (!res.ok) {
          if (res.status === 501) throw new Error('Copy trading is not enabled on this deployment yet.');
          throw new Error(res.status === 404 ? 'Trader not found' : 'Failed to load');
        }
        const data = await res.json();
        if (!cancelled) setTrader(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load trader profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTrader();
    return () => { cancelled = true; };
  }, [address]);

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-panel p-4">
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !trader) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto text-center space-y-4">
        <p className="text-lg text-orange-400" role="alert">{error || 'Trader not found'}</p>
        <button
          type="button"
          onClick={() => navigate('/copy-trading')}
          className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          Back to Copy Trading
        </button>
      </div>
    );
  }

  const totalPnl = safeUsd(trader.totalPnl);

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6 lg:space-y-8">
      {/* Back Button */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* Header */}
      <motion.div
        className="glass-panel p-6 lg:p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white">
              {trader.address.slice(2, 4).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-text-primary font-mono">
                {truncateAddress(trader.address)}
              </h1>
              <p className="text-sm text-text-muted mt-1">
                Lead Trader
                {trader.profitFeeBps > 0 && (
                  <span className="ml-2 text-[var(--primary)]">
                    • {(trader.profitFeeBps / 100).toFixed(1)}% Profit Fee
                  </span>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCopyModalOpen(true)}
            disabled={!COPY_TRADING_ENABLED}
            title={COPY_TRADING_ENABLED ? undefined : 'Copy trading is not enabled on this deployment yet'}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50"
          >
            <Copy className="w-4 h-4" />
            {COPY_TRADING_ENABLED ? 'Copy Trader' : 'Copy Trading Soon'}
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
              <Activity className="w-3.5 h-3.5" />
              Total PnL
            </div>
            <div
              className={clsx(
                'text-xl font-bold font-mono',
                totalPnl >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]'
              )}
            >
              {totalPnl >= 0 ? '+' : ''}
              {formatCompact(totalPnl)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
              <BarChart2 className="w-3.5 h-3.5" />
              ROI
            </div>
            <div
              className={clsx(
                'text-xl font-bold font-mono',
                trader.roi >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]'
              )}
            >
              {trader.roi >= 0 ? '+' : ''}
              {trader.roi.toFixed(1)}%
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
              <Award className="w-3.5 h-3.5" />
              Win Rate
            </div>
            <div className="text-xl font-bold text-text-primary font-mono">
              {trader.winRate.toFixed(1)}%
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
              <Users className="w-3.5 h-3.5" />
              Followers
            </div>
            <div className="text-xl font-bold text-text-primary font-mono">
              {trader.activeFollowers}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Open Positions */}
      <motion.div
        className="glass-panel overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="p-6 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[var(--primary)]" />
            Open Positions ({trader.openPositions.length})
          </h2>
        </div>

        {trader.openPositions.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-muted">
            No open positions at the moment.
          </p>
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-color)] bg-surface-3/30">
                  <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase">Market</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-text-secondary uppercase">Size</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-text-secondary uppercase">Leverage</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-text-secondary uppercase">Entry</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-text-secondary uppercase">PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {trader.openPositions.map((pos, i) => {
                  const pnl = safeUsd(pos.pnl);
                  return (
                    <tr key={i} className="hover:bg-surface-3/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {pos.isLong ? (
                            <TrendingUp className="w-4 h-4 text-[var(--long)]" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-[var(--short)]" />
                          )}
                          <span className="font-bold text-sm text-text-primary">{pos.market}</span>
                          <span
                            className={clsx(
                              'text-xs font-medium px-1.5 py-0.5 rounded',
                              pos.isLong
                                ? 'bg-long/10 text-[var(--long)]'
                                : 'bg-short/10 text-[var(--short)]'
                            )}
                          >
                            {pos.isLong ? 'LONG' : 'SHORT'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-text-primary">
                        ${formatCompact(safeUsd(pos.size))}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-text-primary">
                        {pos.leverage}x
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-text-primary">
                        ${formatCompact(safeUsd(pos.entryPrice))}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span
                          className={clsx(
                            'font-mono text-sm font-bold',
                            pnl >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]'
                          )}
                        >
                          {pnl >= 0 ? '+' : ''}{formatCompact(pnl)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-[var(--border-color)]">
            {trader.openPositions.map((pos, i) => {
              const pnl = safeUsd(pos.pnl);
              return (
                <div key={i} className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {pos.isLong ? (
                        <TrendingUp className="w-4 h-4 shrink-0 text-[var(--long)]" />
                      ) : (
                        <TrendingDown className="w-4 h-4 shrink-0 text-[var(--short)]" />
                      )}
                      <span className="font-bold text-sm text-text-primary truncate">{pos.market}</span>
                      <span
                        className={clsx(
                          'text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0',
                          pos.isLong
                            ? 'bg-long/10 text-[var(--long)]'
                            : 'bg-short/10 text-[var(--short)]'
                        )}
                      >
                        {pos.isLong ? 'LONG' : 'SHORT'}
                      </span>
                    </div>
                    <span
                      className={clsx(
                        'font-mono text-sm font-bold shrink-0',
                        pnl >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]'
                      )}
                    >
                      {pnl >= 0 ? '+' : ''}{formatCompact(pnl)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-text-muted mb-0.5">Size</p>
                      <p className="font-mono text-text-primary">${formatCompact(safeUsd(pos.size))}</p>
                    </div>
                    <div>
                      <p className="text-text-muted mb-0.5">Leverage</p>
                      <p className="font-mono text-text-primary">{pos.leverage}x</p>
                    </div>
                    <div className="text-right">
                      <p className="text-text-muted mb-0.5">Entry</p>
                      <p className="font-mono text-text-primary">${formatCompact(safeUsd(pos.entryPrice))}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
      </motion.div>

      {/* Metadata Display */}
      {trader.metadataURI && (
        <motion.div
          className="glass-panel p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-lg font-bold text-text-primary mb-4 flex items-center gap-2">
            <ExternalLink className="w-5 h-5 text-text-muted" />
            Trader Profile
          </h2>
          <a
            href={trader.metadataURI}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--primary)] hover:underline break-all"
          >
            {trader.metadataURI}
          </a>
        </motion.div>
      )}

      {/* Copy Modal */}
      {address && COPY_TRADING_ENABLED && (
        <CopyModal
          isOpen={copyModalOpen}
          onClose={() => setCopyModalOpen(false)}
          leadTraderAddress={address}
          leadTraderName={truncateAddress(address)}
          profitFeeBps={trader.profitFeeBps}
          usdcAddress={CONTRACT_ADDRESSES.usdc}
          tradingCoreAddress={CONTRACT_ADDRESSES.tradingCore}
          copyRegistryAddress={CONTRACT_ADDRESSES.copyRegistry}
          copyBotAddress={CONTRACT_ADDRESSES.copyBot}
        />
      )}
    </div>
  );
}