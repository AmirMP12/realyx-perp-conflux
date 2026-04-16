import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Loader2, Minus, Plus, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Address } from 'viem';

import { useSettingsStore } from '../../stores/settingsStore';
import { usePositionsStore } from '../../stores';
import { useOpenPosition, OrderType, useUSDCBalance } from '../../hooks/useProgram';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useSound } from '../../hooks/useSound';
import { showToast } from '../ui/Toast';
import { GuidedTooltip } from '../ui/GuidedTooltip';
import { Market } from '../../services/markets';
import { formatPriceWithPrecision } from '../../utils/format';

interface TradingFormProps {
    market: Market;
    currentPrice: number;
    onTradeSuccess?: () => void;
    side?: 'long' | 'short';
    onSideChange?: (side: 'long' | 'short') => void;
}

export function TradingForm({
    market,
    currentPrice,
    onTradeSuccess,
    side: controlledSide,
    onSideChange,
}: TradingFormProps) {
    const { isConnected } = useAccount();
    const settings = useSettingsStore();
    const { addOptimisticPosition, removeOptimisticPosition } = usePositionsStore();

    const { executePosition, isLoading: isPositionLoading, step: positionStep } = useOpenPosition();
    const { balance: usdcBalance, loading: balanceLoading } = useUSDCBalance();
    const { playSuccess, playError } = useSound();

    const [internalSide, setInternalSide] = useState<'long' | 'short'>('long');
    const side = controlledSide ?? internalSide;
    const setSide = onSideChange ?? setInternalSide;
    const [leverage, setLeverage] = useState(settings.defaultLeverage);
    const [size, setSize] = useState('');
    const [margin, setMargin] = useState('');
    const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop'>(settings.defaultOrderType === 'limit' ? 'limit' : 'market');
    const [triggerPrice, setTriggerPrice] = useState('');
    const [showTradeConfirmModal, setShowTradeConfirmModal] = useState(false);



    const [showSettings, setShowSettings] = useState(false);
    const confirmModalRef = useFocusTrap(showTradeConfirmModal);

    const [sizeError, setSizeError] = useState('');
    const [triggerError, setTriggerError] = useState('');

    useEffect(() => {
        setLeverage(settings.defaultLeverage);
    }, [settings.defaultLeverage]);

    const sizeNum = parseFloat(size) || 0;

    // User's 'size' input is their total margin (cost) inclusive of the fee
    let baseMargin = 0;
    let notionalValue = 0;
    let estimatedOpeningFee = 0;

    if (sizeNum > 0 && leverage > 0) {
        baseMargin = sizeNum / (1 + leverage * 0.0005);
        estimatedOpeningFee = baseMargin * leverage * 0.0005;
        if (estimatedOpeningFee < 0.10) {
            estimatedOpeningFee = 0.10;
            baseMargin = sizeNum - 0.10;
            if (baseMargin < 0) baseMargin = 0;
        }
        notionalValue = baseMargin * leverage;
    }

    const marginNum = sizeNum;

    const estLiqPrice = side === 'long'
        ? currentPrice * (1 - 1 / leverage * 0.8)
        : currentPrice * (1 + 1 / leverage * 0.8);

    const tradingFee = notionalValue * 0.001;

    useEffect(() => {
        if (sizeNum > 0 && leverage > 0) {
            setMargin(sizeNum.toFixed(2));
        } else {
            setMargin('');
        }
    }, [sizeNum, leverage]);

    const validateForm = (): boolean => {
        setSizeError('');
        setTriggerError('');
        if (!size.trim()) {
            setSizeError('Enter an amount');
            return false;
        }
        if (sizeNum <= 0 || isNaN(sizeNum)) {
            setSizeError('Invalid amount');
            return false;
        }
        if (isConnected && !balanceLoading && usdcBalance != null && marginNum > usdcBalance) {
            setSizeError('Insufficient Balance');
            return false;
        }
        if ((orderType === 'limit' || orderType === 'stop')) {
            if (!triggerPrice.trim() || parseFloat(triggerPrice) <= 0) {
                setTriggerError('Invalid price');
                return false;
            }
        }
        return true;
    };

    const handleOpenPosition = async () => {
        if (!validateForm()) return;
        if (settings.confirmTrades) {
            setShowTradeConfirmModal(true);
        } else {
            await executeOpenPositionFn();
        }
    };

    const executeOpenPositionFn = async () => {
        const tempId = `opt-${Date.now()}`;

        try {
            addOptimisticPosition({
                tempId,
                marketAddress: market.marketAddress || market.id,
                size: notionalValue.toFixed(4),
                collateral: margin,
                averagePrice: currentPrice.toFixed(2),
                entryPrice: currentPrice.toFixed(2),
                markPrice: currentPrice.toFixed(2),
                pnl: '0',
                leverage: leverage.toString(),
                isLong: side === 'long',
                liquidationPrice: estLiqPrice.toFixed(2),
                stopLossPrice: 0,
                takeProfitPrice: 0,
            });

            const isLimitOrStop = orderType === 'limit' || orderType === 'stop';

            const success = await executePosition({
                market: (market?.marketAddress && market.marketAddress !== '0x...' ? market.marketAddress : market?.id) as Address,
                size: notionalValue.toString(), // executePosition expects the notional value
                leverage: leverage.toString(),
                isLong: side === 'long',
                maxSlippageBps: settings.maxSlippage * 100,
                orderType: orderType === 'market' ? OrderType.MARKET_INCREASE : OrderType.LIMIT_INCREASE,
                triggerPrice: isLimitOrStop ? triggerPrice.trim() : undefined,
                expectedPrice: currentPrice, // Pass currentPrice so leverage/margin calculation in executePosition is accurate
            });

            if (success) {
                removeOptimisticPosition(tempId);
                playSuccess();
                onTradeSuccess?.();
                showToast('success', 'Position Opened', `${side === 'long' ? 'Long' : 'Short'} ${market.symbol} opened successfully`);
                setSize('');
                setShowTradeConfirmModal(false);
            } else {
                removeOptimisticPosition(tempId);
            }
        } catch (error: any) {
            removeOptimisticPosition(tempId);
            playError();
            console.error('Failed to open position:', error);
            const errorMsg = error.message || 'Failed to open position';
            showToast('error', 'Trade Failed', errorMsg);
        }
    };

    const getStatusText = () => {
        if (positionStep === 'APPROVING') return 'Approving...';
        if (positionStep === 'COMMITTING') return 'Committing...';
        return isPositionLoading ? 'Processing...' : (side === 'long' ? 'Buy / Long' : 'Sell / Short');
    };

    return (
        <div className="flex flex-col glass-panel-elevated rounded-2xl overflow-hidden shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
            {/* Tabs */}
            <div className="flex p-2 gap-2 mx-2 mt-2.5 min-w-0">
                <button
                    type="button"
                    onClick={() => setSide('long')}
                    className={clsx(
                        "flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors duration-200 motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--long)]/50",
                            side === 'long' ? "bg-[var(--long)] text-white shadow-lg shadow-emerald-900/25" : "bg-[var(--bg-tertiary)] text-text-secondary hover:text-text-primary border border-[var(--border-color)]/80 hover:border-[var(--border-color-hover)]"
                    )}
                >
                    Long
                </button>
                <button
                    type="button"
                    onClick={() => setSide('short')}
                    className={clsx(
                        "flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors duration-200 motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--short)]/50",
                            side === 'short' ? "bg-[var(--short)] text-white shadow-lg shadow-rose-900/25" : "bg-[var(--bg-tertiary)] text-text-secondary hover:text-text-primary border border-[var(--border-color)]/80 hover:border-[var(--border-color-hover)]"
                    )}
                >
                    Short
                </button>
            </div>

            {/* Order Type Selector + Settings Gear */}
            <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 mx-2 border-b border-[var(--border-color)]/60 gap-2 min-w-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]">
                <div className="flex gap-3 sm:gap-4 text-xs font-medium text-text-secondary shrink-0">
                    {(['market', 'limit'] as const).map(type => (
                        <button
                            key={type}
                            type="button"
                            data-testid={`order-type-${type}`}
                            onClick={() => setOrderType(type)}
                            className={clsx(
                                "capitalize transition-colors hover:text-text-primary rounded-lg px-1 -mx-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40",
                                orderType === type ? "text-text-primary" : "text-text-secondary"
                            )}
                        >
                            {type}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Isolated
                    </span>
                    <button
                        type="button"
                        onClick={() => setShowSettings(!showSettings)}
                        className={clsx(
                            "p-2 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40",
                            showSettings
                                ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                                : "text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)]"
                        )}
                        title="Trading Settings"
                        aria-expanded={showSettings}
                        aria-label="Trading settings"
                    >
                        <Settings className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Inline Settings Panel */}
            <AnimatePresence>
                {showSettings && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-b border-[var(--border-color)]"
                    >
                        <div className="p-4 space-y-3 bg-[var(--bg-tertiary)]/70 border-b border-[var(--border-color)]/80">
                            <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Trading Settings</div>

                            {/* Allowed Slippage */}
                            <div className="flex flex-col gap-2">
                                <span className="text-xs text-text-secondary">Allowed Slippage</span>
                                <div className="flex items-center gap-1.5 bg-[var(--bg-secondary)] p-1 rounded">
                                    {[0.1, 0.5, 1.0].map(val => (
                                        <button
                                            key={val}
                                            onClick={() => settings.setMaxSlippage(val)}
                                            className={clsx(
                                                "flex-1 py-1 text-[10px] font-mono font-medium rounded transition-colors",
                                                settings.maxSlippage === val
                                                    ? "bg-[var(--primary)] text-white shadow-sm"
                                                    : "text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)]"
                                            )}
                                        >
                                            {val}%
                                        </button>
                                    ))}
                                    <div className="relative w-16 group">
                                        <input
                                            type="number"
                                            value={settings.maxSlippage}
                                            onChange={e => settings.setMaxSlippage(Math.max(0, parseFloat(e.target.value) || 0))}
                                            className={clsx(
                                                "w-full bg-transparent text-center text-[10px] font-mono focus:outline-none py-1 rounded",
                                                ![0.1, 0.5, 1.0].includes(settings.maxSlippage) ? "text-[var(--primary)] font-bold" : "text-text-secondary"
                                            )}
                                        />
                                        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-text-muted pointer-events-none">%</span>
                                    </div>
                                </div>
                            </div>

                            {/* Confirm Trades */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">Confirm Trades</span>
                                <button
                                    onClick={() => settings.setConfirmTrades(!settings.confirmTrades)}
                                    className={clsx(
                                        "relative w-8 h-4 rounded-full transition-colors",
                                        settings.confirmTrades ? "bg-[var(--primary)]" : "bg-[var(--bg-secondary)]"
                                    )}
                                >
                                    <span className={clsx(
                                        "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                                        settings.confirmTrades ? "translate-x-4" : "translate-x-0.5"
                                    )} />
                                </button>
                            </div>

                            {/* Show PnL % */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">Show PnL %</span>
                                <button
                                    onClick={() => settings.setShowPnlPercent(!settings.showPnlPercent)}
                                    className={clsx(
                                        "relative w-8 h-4 rounded-full transition-colors",
                                        settings.showPnlPercent ? "bg-[var(--primary)]" : "bg-[var(--bg-secondary)]"
                                    )}
                                >
                                    <span className={clsx(
                                        "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                                        settings.showPnlPercent ? "translate-x-4" : "translate-x-0.5"
                                    )} />
                                </button>
                            </div>

                            {/* Auto-close on Liquidation */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">Liquidation Warnings</span>
                                <button
                                    onClick={() => settings.setLiquidationWarnings(!settings.liquidationWarnings)}
                                    className={clsx(
                                        "relative w-8 h-4 rounded-full transition-colors",
                                        settings.liquidationWarnings ? "bg-[var(--primary)]" : "bg-[var(--bg-secondary)]"
                                    )}
                                >
                                    <span className={clsx(
                                        "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                                        settings.liquidationWarnings ? "translate-x-4" : "translate-x-0.5"
                                    )} />
                                </button>
                            </div>

                            {/* Compact Mode */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">Compact Mode</span>
                                <button
                                    onClick={() => settings.setCompactMode(!settings.compactMode)}
                                    className={clsx(
                                        "relative w-8 h-4 rounded-full transition-colors",
                                        settings.compactMode ? "bg-[var(--primary)]" : "bg-[var(--bg-secondary)]"
                                    )}
                                >
                                    <span className={clsx(
                                        "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                                        settings.compactMode ? "translate-x-4" : "translate-x-0.5"
                                    )} />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="p-3 sm:p-4 space-y-3.5 sm:space-y-4 mx-2 min-w-0">
                {/* Trigger Price Input */}
                {(orderType === 'limit' || orderType === 'stop') && (
                    <div className="rounded-xl p-3 border border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                        <div className="flex justify-between text-xs text-text-secondary mb-1 gap-2">
                            <span>Price</span>
                            <span className="tabular-nums shrink-0">Mark: ${formatPriceWithPrecision(currentPrice)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                inputMode="decimal"
                                data-testid="trigger-price"
                                value={triggerPrice}
                                onChange={e => setTriggerPrice(e.target.value)}
                                placeholder="0.00"
                                className="bg-transparent w-full text-lg font-mono text-text-primary focus:outline-none placeholder-text-muted [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <span className="text-xs font-bold text-text-secondary">USD</span>
                        </div>
                        {triggerError && <div className="text-[10px] text-rose-500 mt-1">{triggerError}</div>}
                    </div>
                )}

                {/* Amount Input */}
                <div className="rounded-xl p-3 border border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/70 focus-within:border-[var(--primary)]/55 focus-within:ring-2 focus-within:ring-[var(--primary)]/15 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                    <div className="flex justify-between items-center text-xs text-text-secondary mb-2">
                        <span>Margin (USDC)</span>
                        <span className="tabular-nums">
                            Balance: {balanceLoading ? '…' : (usdcBalance != null ? usdcBalance.toFixed(2) : '0.00')} USDC
                        </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]/70 px-3 py-2 focus-within:border-[var(--primary)]/50 transition-colors">
                        <input
                            type="number"
                            inputMode="decimal"
                            data-testid="margin-input"
                            value={size}
                            onChange={e => setSize(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 min-w-0 bg-transparent text-lg font-mono text-text-primary focus:outline-none placeholder-text-muted [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-xs font-medium text-text-muted shrink-0">USDC</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        {[25, 50, 75].map((pct) => (
                            <button
                                key={pct}
                                type="button"
                                className="flex-1 py-1.5 text-[11px] font-medium rounded-lg bg-[var(--bg-secondary)] text-text-secondary hover:text-text-primary hover:bg-[var(--border-color)]/50 border border-[var(--border-color)]/30 transition-colors"
                                onClick={() => {
                                    const bal = usdcBalance ?? 0;
                                    setSize((bal * (pct / 100)).toFixed(2));
                                }}
                            >
                                {pct}%
                            </button>
                        ))}
                        <button
                            type="button"
                            className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-[var(--primary)]/15 text-[var(--primary)] hover:bg-[var(--primary)]/25 border border-[var(--primary)]/30 transition-colors"
                            onClick={() => setSize((usdcBalance ?? 0).toFixed(4))}
                        >
                            Max
                        </button>
                    </div>
                    {sizeError && <div className="text-[10px] text-rose-500 mt-2">{sizeError}</div>}
                    {isConnected && !balanceLoading && usdcBalance != null && usdcBalance === 0 && (
                        <Link
                            to="/settings"
                            className="mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium hover:bg-amber-500/15 transition-colors"
                        >
                            Mint test USDC in Settings
                        </Link>
                    )}
                </div>

                {/* Leverage Slider */}
                <div className="rounded-xl p-3 border border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/70">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs text-text-secondary mb-2">
                        <GuidedTooltip id="leverage" title="Leverage" content="Higher leverage amplifies both gains and losses. Your position can be liquidated if price moves against you.">
                            <span>Leverage</span>
                        </GuidedTooltip>
                        <div className="flex items-center rounded-xl overflow-hidden border border-[var(--border-color)]/60 bg-[var(--bg-tertiary)]/60 w-fit shrink-0">
                            <button
                                type="button"
                                onClick={() => setLeverage(Math.max(1, leverage - 1))}
                                disabled={leverage <= 1}
                                className="flex items-center justify-center w-9 h-8 text-text-secondary hover:text-text-primary hover:bg-[var(--border-color)] disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                                aria-label="Decrease leverage"
                            >
                                <Minus className="w-3.5 h-3.5" strokeWidth={2.5} />
                            </button>
                            <div className="min-w-[3rem] text-center text-sm font-mono font-semibold text-text-primary py-1.5">
                                {leverage.toFixed(1)}x
                            </div>
                            <button
                                type="button"
                                onClick={() => setLeverage(Math.min(10, leverage + 1))}
                                disabled={leverage >= 10}
                                className="flex items-center justify-center w-9 h-8 text-text-secondary hover:text-text-primary hover:bg-[var(--border-color)] disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                                aria-label="Increase leverage"
                            >
                                <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                            </button>
                        </div>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={leverage}
                        onChange={e => setLeverage(Number(e.target.value))}
                        className="w-full h-1 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
                    />
                    <div className="flex flex-wrap justify-between sm:justify-between mt-2 gap-1.5">
                        {[2, 4, 6, 8, 10].map(val => (
                            <button
                                key={val}
                                onClick={() => setLeverage(val)}
                                className={clsx(
                                    "px-2 py-1 bg-[var(--bg-tertiary)] rounded text-[10px] text-text-secondary hover:text-text-primary hover:bg-[var(--border-color)] transition-colors",
                                    leverage === val && "bg-[var(--border-color)] text-text-primary"
                                )}
                            >
                                {val}x
                            </button>
                        ))}
                    </div>
                </div>

                {/* TP / SL Toggle Section */}


                {/* Liquidation distance */}
                {sizeNum > 0 && (
                    <div className="rounded-xl p-3 border border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/70">
                        <div className="flex justify-between text-xs text-text-secondary mb-1">
                            <span>Liquidation distance</span>
                            <span className="text-orange-400 font-medium">
                                {side === 'long'
                                    ? `${(((currentPrice - estLiqPrice) / currentPrice) * 100).toFixed(1)}%`
                                    : `${(((estLiqPrice - currentPrice) / currentPrice) * 100).toFixed(1)}%`}{' '}
                                to liq.
                            </span>
                        </div>
                        <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                            <div
                                className={clsx("h-full rounded-full transition-all", side === 'long' ? "bg-[var(--short)]" : "bg-[var(--long)]")}
                                style={{
                                    width: `${Math.min(100, (side === 'long'
                                        ? ((currentPrice - estLiqPrice) / currentPrice) * 100
                                        : ((estLiqPrice - currentPrice) / estLiqPrice) * 100))}%`,
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Summary */}
                <div className="space-y-2 pt-3 mt-1 border border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/50 rounded-xl p-3">
                    <SummaryRow label="Margin Mode" value="Isolated" valueClass="text-amber-400" />
                    <SummaryRow label="Collateral" value={`$${margin || '0.00'}`} />
                    <SummaryRow label="Entry Price" value={`$${formatPriceWithPrecision(currentPrice)}`} />
                    <SummaryRow label="Liq. Price" value={`$${formatPriceWithPrecision(estLiqPrice)}`} valueClass={side === 'long' ? "text-[var(--short)]" : "text-[var(--long)]"} />
                    <SummaryRow label="Est. Fee (0.1%)" value={`$${tradingFee.toFixed(2)}`} />
                    <SummaryRow label="Funding / 1h" value={`${((market.fundingRate ?? 0) * 100).toFixed(4)}%`} valueClass={(market.fundingRate ?? 0) > 0 ? "text-[var(--long)]" : "text-[var(--short)]"} />
                </div>
            </div>

            {/* Action Button */}
            <div className="p-3 sm:p-4 mx-2 mb-2 border-t border-[var(--border-color)]/80 bg-[var(--bg-secondary)] rounded-b-2xl">
                {isConnected ? (
                    <button
                        type="button"
                        onClick={handleOpenPosition}
                        disabled={isPositionLoading}
                        data-testid="trade-button"
                        className={clsx(
                            "w-full py-3.5 rounded-xl text-sm font-bold uppercase transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.99] disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] focus-visible:ring-white/30",
                            side === 'long'
                                ? "bg-[var(--long)] text-white hover:opacity-95 shadow-lg shadow-emerald-900/25"
                                : "bg-[var(--short)] text-white hover:opacity-95 shadow-lg shadow-rose-900/25"
                        )}
                    >
                        {isPositionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {getStatusText()} {market.symbol}
                    </button>
                ) : (
                    <div className="w-full">
                        <ConnectButton.Custom>
                            {({ openConnectModal }) => (
                                <button type="button" onClick={openConnectModal} className="w-full py-3.5 rounded-xl bg-[var(--primary)] text-white font-bold hover:opacity-90 transition-all duration-200 motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/50">
                                    Connect Wallet
                                </button>
                            )}
                        </ConnectButton.Custom>
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            <AnimatePresence>
                {showTradeConfirmModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-trade-title">
                        <motion.div
                            ref={confirmModalRef}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-6 max-w-sm w-full shadow-2xl relative"
                        >
                            <h2 id="confirm-trade-title" data-testid="confirm-modal-title" className="text-lg font-bold mb-4 text-text-primary">Confirm Trade</h2>
                            <div className="space-y-3 text-sm mb-6">
                                <SummaryRow label="Market" value={market.symbol} />
                                <SummaryRow label="Side" value={side.toUpperCase()} valueClass={side === 'long' ? 'text-[var(--long)]' : 'text-[var(--short)]'} />
                                <SummaryRow label="Notional Size" value={`$${notionalValue.toFixed(2)}`} />
                                <SummaryRow label="Leverage" value={`${leverage}x`} />
                                <SummaryRow label="Total Margin" value={`$${margin}`} />
                                <SummaryRow label="Entry Price" value={`$${currentPrice.toFixed(2)}`} />
                                <div className="border-t border-[var(--border-color)] pt-3 mt-3 space-y-2">
                                    <SummaryRow label="Est. Fee (0.1%)" value={`$${tradingFee.toFixed(2)}`} />
                                    <SummaryRow label="Max Slippage" value={`${settings.maxSlippage}%`} />
                                </div>
                                <div className="border-t border-[var(--border-color)] pt-3 mt-3 space-y-2">
                                    <SummaryRow label="Liq. Price" value={`$${estLiqPrice.toFixed(2)}`} valueClass="text-orange-400" />
                                    <SummaryRow
                                        label="Liq. Risk"
                                        value={`${(side === 'long'
                                            ? ((currentPrice - estLiqPrice) / currentPrice) * 100
                                            : ((estLiqPrice - currentPrice) / currentPrice) * 100
                                        ).toFixed(1)}% move to liquidate`}
                                        valueClass="text-orange-400"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowTradeConfirmModal(false)}
                                    className="flex-1 py-2 rounded border border-[var(--border-color)] text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)]"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={executeOpenPositionFn}
                                    disabled={isPositionLoading}
                                    className={clsx(
                                        "flex-1 py-2 rounded font-bold text-white",
                                        side === 'long' ? "bg-[var(--long)]" : "bg-[var(--short)]"
                                    )}
                                >
                                    {isPositionLoading ? 'Confirming...' : 'Confirm'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

function SummaryRow({ label, value, valueClass = "text-text-primary" }: { label: string, value: string, valueClass?: string }) {
    return (
        <div className="flex justify-between text-xs">
            <span className="text-text-secondary">{label}</span>
            <span className={clsx("font-mono font-medium", valueClass)}>{value}</span>
        </div>
    );
}
