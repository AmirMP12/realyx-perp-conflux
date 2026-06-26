import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Loader2, Minus, Plus, Settings, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Address } from 'viem';

import { useSettingsStore } from '../../stores/settingsStore';
import { usePositionsStore } from '../../stores';
import { useOpenPosition, OrderType, useUSDCBalance, useMarginMode } from '../../hooks/useProgram';
import { useCollateralAssets, formatHaircut, type CollateralAsset } from '../../hooks/useCollateral';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useSound } from '../../hooks/useSound';
import { useAccountRisk } from '../../hooks/useAccountRisk';
import { showToast } from '../ui/Toast';
import { GuidedTooltip } from '../ui/GuidedTooltip';
import { CollateralSelector } from './CollateralSelector';
import { Market } from '../../services/markets';
import { formatPriceWithPrecision } from '../../utils/format';
import { isolatedLiquidationPrice, distanceToLiquidationPct, healthFactorMeta } from '../../utils/risk';
import { computeMarginPreview, payForNotional, triggerReturnPct, computeCostToHold } from '../../utils/tradePreview';
import { MarketSessionBadge } from '../MarketSessionBadge';
import { useMarketSession } from '../../hooks/useMarketSession';

interface TradingFormProps {
    market: Market;
    currentPrice: number;
    /** Real on-chain max leverage for this market (from getMarketInfo). Falls back to 10x. */
    maxLeverage?: number;
    onTradeSuccess?: () => void;
    side?: 'long' | 'short';
    onSideChange?: (side: 'long' | 'short') => void;
    onPriceRefresh?: () => Promise<void> | void;
    className?: string;
}

export function TradingForm({
    market,
    currentPrice,
    maxLeverage,
    onTradeSuccess,
    side: controlledSide,
    onSideChange,
    onPriceRefresh,
    className,
}: TradingFormProps) {
    const { isConnected } = useAccount();
    const settings = useSettingsStore();
    const { addOptimisticPosition, removeOptimisticPosition } = usePositionsStore();

    const { executePosition, isLoading: isPositionLoading, step: positionStep } = useOpenPosition();
    const { balance: usdcBalance, loading: balanceLoading } = useUSDCBalance();
    const { mode: protocolMarginMode } = useMarginMode();
    const { playSuccess, playError } = useSound();

    // Multi-collateral: USDT0 + any token registered in CollateralRegistry.
    const { assets: collateralAssets, usdc: usdcAsset, ordersEnabled: altOrdersEnabled, loading: collateralLoading } = useCollateralAssets();
    const [collateral, setCollateral] = useState<CollateralAsset>(usdcAsset);
    const isAltCollateral = !collateral.isUSDC;
    // Keep the selected collateral object in sync as registry reads resolve.
    useEffect(() => {
        const match = collateralAssets.find((a) => a.address.toLowerCase() === collateral.address.toLowerCase());
        if (match && match !== collateral) setCollateral(match);
    }, [collateralAssets]);

    const [internalSide, setInternalSide] = useState<'long' | 'short'>('long');
    const side = controlledSide ?? internalSide;
    const setSide = onSideChange ?? setInternalSide;
    const [leverage, setLeverage] = useState(settings.defaultLeverage);
    // Real per-market leverage cap (on-chain getMarketInfo). Fall back to 10x
    // only when the read hasn't resolved yet, so the slider/risk math reflect
    // the actual market instead of a hardcoded ceiling.
    const maxLev = Math.max(2, Math.floor(maxLeverage && maxLeverage > 0 ? maxLeverage : 10));
    // If the cap drops below the current selection (e.g. switching to a lower-
    // leverage market), pull the leverage back into the valid range.
    useEffect(() => {
        setLeverage((lev) => (lev > maxLev ? maxLev : lev));
    }, [maxLev]);
    const [size, setSize] = useState('');
    const [margin, setMargin] = useState('');
    // Order-ticket input mode: 'pay' = user types total collateral (incl. fee);
    // 'size' = user types the position notional and we derive the required pay.
    // Mirrors the GMX/Hyperliquid "Pay / Position Size" toggle so the amount
    // field is never ambiguous.
    const [amountMode, setAmountMode] = useState<'pay' | 'size'>('pay');
    const [orderType, setOrderType] = useState<'market' | 'limit'>(settings.defaultOrderType === 'limit' ? 'limit' : 'market');
    const [triggerPrice, setTriggerPrice] = useState('');
    const [showTradeConfirmModal, setShowTradeConfirmModal] = useState(false);

    // Time-in-force: only GTC and POST_ONLY are honored by the deployed contract.
    const [postOnly, setPostOnly] = useState(false);

    // Bracket order (TP/SL applied to the position the keeper mints on fill).
    const [bracketEnabled, setBracketEnabled] = useState(false);
    const [takeProfitPrice, setTakeProfitPrice] = useState('');
    const [stopLossPrice, setStopLossPrice] = useState('');

    // Authoritative cross-margin account risk (real on-chain liquidation math).
    const accountRisk = useAccountRisk();

    // Margin mode is a protocol-wide setting on this deployment (createOrder takes
    // no per-order flag), so new positions always open in the protocol's mode.
    // We surface it and keep the UI in sync with the on-chain value.
    const marginModeLabel = protocolMarginMode === 'cross' ? 'Cross' : 'Isolated';



    const [showSettings, setShowSettings] = useState(false);
    const confirmModalRef = useFocusTrap(showTradeConfirmModal);

    const [sizeError, setSizeError] = useState('');
    const [triggerError, setTriggerError] = useState('');

    // Restore pending trade state from sessionStorage on mount (fixes mobile reloads)
    useEffect(() => {
        try {
            const saved = sessionStorage.getItem('pending_trade');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.marketId === market.id || data.marketAddress === market.marketAddress) {
                    if (data.size) setSize(data.size);
                    if (data.leverage) setLeverage(data.leverage);
                    if (data.side) setSide(data.side);
                    if (data.orderType) setOrderType(data.orderType);
                    if (data.triggerPrice) setTriggerPrice(data.triggerPrice);
                }
                sessionStorage.removeItem('pending_trade');
            }
        } catch (e) {
            console.warn('Failed to restore pending trade:', e);
        }
    }, [market.id, market.marketAddress]);

    useEffect(() => {
        setLeverage(settings.defaultLeverage);
    }, [settings.defaultLeverage]);

    const rawInput = parseFloat(size) || 0;

    // Effective USDC spending power for the chosen collateral. USDC = wallet balance;
    // alt collateral = post-haircut USDC value reported by CollateralRegistry.
    const spendableUsdc = isAltCollateral ? collateral.effectiveUsdcFormatted : usdcBalance;
    const balanceIsLoading = isAltCollateral ? collateralLoading : balanceLoading;

    // Normalize the input to a single "total pay" value regardless of which mode
    // the user is typing in, then run the one fee model. In 'size' mode the input
    // is the desired position notional, so we invert it to the required pay.
    const sizeNum = amountMode === 'size' ? payForNotional(rawInput, leverage) : rawInput;

    // Derivation lives in the pure, unit-tested `computeMarginPreview` so the
    // on-screen preview always matches the submitted order.
    const { notionalValue, tradingFee } = computeMarginPreview(sizeNum, leverage);

    const marginNum = sizeNum;

    // Accurate liquidation price using the protocol's real maintenance-margin
    // curve (ported from PositionMath.calculateLiquidationPrice), not a heuristic.
    // For new positions PnL is 0 at entry, so the isolated formula is exact;
    // cross-margin only ever improves this (more offsetting collateral), so it
    // is a conservative floor.
    const refEntryPrice = orderType === 'limit' && parseFloat(triggerPrice) > 0 ? parseFloat(triggerPrice) : currentPrice;
    const estLiqPriceRaw = isolatedLiquidationPrice(refEntryPrice, leverage, notionalValue, side === 'long');
    const estLiqPrice = estLiqPriceRaw ?? 0;
    const hasLiqPrice = estLiqPriceRaw != null && estLiqPriceRaw > 0;

    // Bracket PnL preview (% of margin) at the entered TP/SL trigger prices.
    const tpNum = parseFloat(takeProfitPrice);
    const slNum = parseFloat(stopLossPrice);
    const tpGainPct = bracketEnabled
        ? triggerReturnPct(tpNum, refEntryPrice, leverage, side === 'long')
        : null;
    const slLossPct = bracketEnabled
        ? triggerReturnPct(slNum, refEntryPrice, leverage, side === 'long')
        : null;

    // "Cost to hold" — opening fee + funding direction/magnitude over the first
    // day. Gives the trader the all-in carry cost before they commit, the way
    // Hyperliquid/GMX surface it, instead of a bare funding %.
    const costToHold = computeCostToHold(market.fundingRate ?? 0, notionalValue, side === 'long');
    const firstDayCarry = tradingFee + Math.max(0, costToHold.fundingPer24h);

    useEffect(() => {
        if (sizeNum > 0 && leverage > 0) {
            setMargin(sizeNum.toFixed(2));
        } else {
            setMargin('');
        }
    }, [sizeNum, leverage]);

    // Live market session for the gap-risk warning + ticket badge (RWA equities).
    const marketSession = useMarketSession(market.category);

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
        if (isConnected && !balanceIsLoading && spendableUsdc != null && marginNum > spendableUsdc) {
            setSizeError('Insufficient Balance');
            return false;
        }
        if (orderType === 'limit') {
            if (!triggerPrice.trim() || parseFloat(triggerPrice) <= 0) {
                setTriggerError('Invalid price');
                return false;
            }
        }
        // Bracket validation mirrors the on-chain checks (long: SL<entry<TP).
        if (bracketEnabled) {
            const ref = refEntryPrice;
            const tp = parseFloat(takeProfitPrice);
            const sl = parseFloat(stopLossPrice);
            if (takeProfitPrice.trim() && tp > 0) {
                if (side === 'long' && tp <= ref) {
                    setSizeError('Take-profit must be above entry for a long');
                    return false;
                }
                if (side === 'short' && tp >= ref) {
                    setSizeError('Take-profit must be below entry for a short');
                    return false;
                }
            }
            if (stopLossPrice.trim() && sl > 0) {
                if (side === 'long' && sl >= ref) {
                    setSizeError('Stop-loss must be below entry for a long');
                    return false;
                }
                if (side === 'short' && sl <= ref) {
                    setSizeError('Stop-loss must be above entry for a short');
                    return false;
                }
            }
        }
        return true;
    };

    const handleOpenPosition = async () => {
        if (!validateForm()) return;
        // Absolute latest price refresh before confirming or executing
        await onPriceRefresh?.();
        
        if (settings.confirmTrades) {
            setShowTradeConfirmModal(true);
        } else {
            await executeOpenPositionFn();
        }
    };

    const executeOpenPositionFn = async () => {
        const tempId = `opt-${Date.now()}`;

        try {
            // Persist trade state for mobile recovery
            sessionStorage.setItem('pending_trade', JSON.stringify({
                marketId: market.id,
                marketAddress: market.marketAddress,
                size,
                leverage,
                side,
                orderType,
                triggerPrice,
                timestamp: Date.now()
            }));

            addOptimisticPosition({
                tempId,
                marketAddress: market.marketAddress || market.id,
                size: notionalValue.toFixed(4),
                collateral: margin,
                averagePrice: currentPrice.toString(),
                entryPrice: currentPrice.toString(),
                markPrice: currentPrice.toString(),
                pnl: '0',
                leverage: leverage.toString(),
                isLong: side === 'long',
                liquidationPrice: estLiqPrice.toString(),
                stopLossPrice: 0,
                takeProfitPrice: 0,
            });

            const isLimit = orderType === 'limit';

            const success = await executePosition({
                market: (market?.marketAddress && market.marketAddress !== '0x...' ? market.marketAddress : market?.id) as Address,
                size: notionalValue.toString(), // executePosition expects the notional value
                leverage: leverage.toString(),
                isLong: side === 'long',
                maxSlippageBps: settings.maxSlippage * 100,
                orderType: orderType === 'market' ? OrderType.MARKET_INCREASE : OrderType.LIMIT_INCREASE,
                triggerPrice: isLimit ? triggerPrice.trim() : undefined,
                expectedPrice: refEntryPrice, // entry reference for bracket validation + margin calc
                collateralToken: isAltCollateral && altOrdersEnabled ? (collateral.address as Address) : undefined,
                // Time-in-force: post-only only valid for limit orders on-chain.
                tif: isLimit && postOnly ? 3 /* POST_ONLY */ : 0 /* GTC */,
                takeProfitTrigger: bracketEnabled && takeProfitPrice.trim() ? takeProfitPrice.trim() : undefined,
                stopLossTrigger: bracketEnabled && stopLossPrice.trim() ? stopLossPrice.trim() : undefined,
            });

            if (success) {
                removeOptimisticPosition(tempId);
                sessionStorage.removeItem('pending_trade');
                playSuccess();
                onTradeSuccess?.();
                showToast('success', 'Position Opened', `${side === 'long' ? 'Long' : 'Short'} ${market.symbol} opened successfully`);
                setSize('');
                setTakeProfitPrice('');
                setStopLossPrice('');
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
        <div className={clsx("flex flex-col glass-panel-elevated rounded-2xl overflow-hidden shadow-[0_24px_50px_rgba(0,0,0,0.4)] h-full lg:max-h-[720px]", className)}>
            {/* Long / Short segmented control */}
            <div className="p-2.5 shrink-0">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-3/60 border border-line/60">
                    <button
                        type="button"
                        onClick={() => setSide('long')}
                        aria-pressed={side === 'long'}
                        className={clsx(
                            "py-2.5 text-sm font-bold rounded-lg transition-all duration-200 motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-long/50 flex items-center justify-center gap-1.5",
                            side === 'long'
                                ? "bg-[var(--long)] text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)]"
                                : "text-text-secondary hover:text-[var(--long)]"
                        )}
                    >
                        <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2.75} aria-hidden />
                        Long
                    </button>
                    <button
                        type="button"
                        onClick={() => setSide('short')}
                        aria-pressed={side === 'short'}
                        className={clsx(
                            "py-2.5 text-sm font-bold rounded-lg transition-all duration-200 motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-short/50 flex items-center justify-center gap-1.5",
                            side === 'short'
                                ? "bg-[var(--short)] text-white shadow-[0_4px_14px_rgba(244,63,94,0.3)]"
                                : "text-text-secondary hover:text-[var(--short)]"
                        )}
                    >
                        <ArrowDownRight className="w-3.5 h-3.5" strokeWidth={2.75} aria-hidden />
                        Short
                    </button>
                </div>
            </div>

            {/* Order Type + Margin Mode */}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-y border-line/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] overflow-visible relative z-10">
                <div className="flex items-center rounded-lg bg-surface-3/60 border border-line/60 p-0.5 gap-0.5">
                    {(['market', 'limit'] as const).map(type => (
                        <button
                            key={type}
                            type="button"
                            data-testid={`order-type-${type}`}
                            onClick={() => setOrderType(type)}
                            className={clsx(
                                "capitalize px-3 py-1 rounded-md text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                                orderType === type ? "bg-[var(--bg-secondary)] text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
                            )}
                        >
                            {type}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <span
                        className={clsx(
                            'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border',
                            protocolMarginMode === 'cross'
                                ? 'bg-brand/10 text-[var(--primary)] border-brand/25'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                        )}
                    >
                        <span className={clsx('w-1.5 h-1.5 rounded-full', protocolMarginMode === 'cross' ? 'bg-[var(--primary)]' : 'bg-amber-400')} />
                        {marginModeLabel}
                    </span>
                    <button
                        type="button"
                        onClick={() => setShowSettings(!showSettings)}
                        className={clsx(
                            "p-2 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                            showSettings
                                ? "bg-brand/20 text-[var(--primary)]"
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
                        className="overflow-hidden border-b border-line/80"
                    >
                        <div className="p-3.5 bg-surface-3/50">
                            <div className="rounded-xl border border-line/60 bg-[var(--bg-secondary)] overflow-hidden shadow-sm">
                                {/* Header */}
                                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]">
                                    <Settings className="w-3.5 h-3.5 text-[var(--primary)]" />
                                    <span className="text-[11px] font-bold text-text-primary uppercase tracking-wider">Trading Settings</span>
                                </div>

                                {/* Allowed Slippage */}
                                <div className="px-3.5 py-3 border-b border-line/50">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-medium text-text-secondary">Allowed Slippage</span>
                                        <span className="text-[11px] font-mono font-semibold text-[var(--primary)] tabular-nums">{settings.maxSlippage}%</span>
                                    </div>
                                    <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-3/60 border border-line/60">
                                        {[0.1, 0.5, 1.0].map(val => (
                                            <button
                                                key={val}
                                                type="button"
                                                onClick={() => settings.setMaxSlippage(val)}
                                                className={clsx(
                                                    "flex-1 py-1.5 text-[11px] font-mono font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                                                    settings.maxSlippage === val
                                                        ? "bg-[var(--primary)] text-white shadow-sm"
                                                        : "text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)]"
                                                )}
                                            >
                                                {val}%
                                            </button>
                                        ))}
                                        <div className="relative flex-1 min-w-[3.5rem]">
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                value={settings.maxSlippage}
                                                onChange={e => settings.setMaxSlippage(Math.max(0, parseFloat(e.target.value) || 0))}
                                                placeholder="Custom"
                                                className={clsx(
                                                    "w-full bg-[var(--bg-secondary)] border border-line/60 text-center text-[11px] font-mono rounded-md focus:outline-none focus:border-brand/50 py-1.5 pr-4 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors",
                                                    ![0.1, 0.5, 1.0].includes(settings.maxSlippage) ? "text-[var(--primary)] font-bold border-brand/40" : "text-text-secondary"
                                                )}
                                            />
                                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-text-muted pointer-events-none">%</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Toggles */}
                                <div className="divide-y divide-line/40">
                                    <SettingToggle
                                        label="Confirm Trades"
                                        checked={settings.confirmTrades}
                                        onChange={() => settings.setConfirmTrades(!settings.confirmTrades)}
                                    />
                                    <SettingToggle
                                        label="Show PnL %"
                                        checked={settings.showPnlPercent}
                                        onChange={() => settings.setShowPnlPercent(!settings.showPnlPercent)}
                                    />
                                    <SettingToggle
                                        label="Liquidation Warnings"
                                        checked={settings.liquidationWarnings}
                                        onChange={() => settings.setLiquidationWarnings(!settings.liquidationWarnings)}
                                    />
                                    <SettingToggle
                                        label="Compact Mode"
                                        checked={settings.compactMode}
                                        onChange={() => settings.setCompactMode(!settings.compactMode)}
                                    />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="px-3.5 py-4 space-y-4 min-w-0 flex-1 overflow-y-auto custom-scrollbar overflow-x-hidden">
                {/* Trigger Price Input */}
                {orderType === 'limit' && (
                    <div className="rounded-xl p-3 border border-line/80 bg-surface-3/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
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

                        {/* Post-only (maker) — only valid for limit orders on-chain. */}
                        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-line/50">
                            <GuidedTooltip
                                id="post-only"
                                title="Post-only (maker)"
                                content="The order is only accepted if it would rest away from the current price (won't fill immediately). Orders that would cross are rejected on-chain."
                            >
                                <span className="text-xs text-text-secondary">Post-only</span>
                            </GuidedTooltip>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={postOnly}
                                aria-label="Post-only"
                                onClick={() => setPostOnly(v => !v)}
                                className={clsx(
                                    'relative inline-flex items-center h-5 w-9 rounded-full p-0.5 transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                    postOnly ? 'bg-[var(--primary)]' : 'bg-surface-3/80 border border-line/70',
                                )}
                            >
                                <span className={clsx('h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200', postOnly ? 'translate-x-4' : 'translate-x-0')} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Collateral Selector (multi-collateral) */}
                <CollateralSelector
                    assets={collateralAssets}
                    selected={collateral}
                    onSelect={setCollateral}
                    ordersEnabled={altOrdersEnabled}
                    loading={collateralLoading}
                />

                {/* Amount Input */}
                <div className="rounded-xl p-3.5 border border-line/60 bg-surface-3/40 focus-within:border-brand/55 focus-within:ring-2 focus-within:ring-brand/15 transition-all shadow-sm overflow-hidden">
                    {/* Pay / Position Size mode toggle (GMX/Hyperliquid pattern). */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center rounded-lg bg-surface-3/70 border border-line/60 p-0.5 gap-0.5">
                            {([
                                { id: 'pay' as const, label: 'Pay' },
                                { id: 'size' as const, label: 'Position Size' },
                            ]).map((m) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    data-testid={`amount-mode-${m.id}`}
                                    onClick={() => {
                                        if (m.id === amountMode) return;
                                        // Convert the current value so the displayed amount stays
                                        // economically equivalent when switching modes.
                                        if (rawInput > 0 && leverage > 0) {
                                            if (m.id === 'size') {
                                                setSize(notionalValue.toFixed(2));
                                            } else {
                                                setSize(payForNotional(rawInput, leverage).toFixed(2));
                                            }
                                        }
                                        setAmountMode(m.id);
                                    }}
                                    className={clsx(
                                        'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                        amountMode === m.id ? 'bg-[var(--bg-secondary)] text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
                                    )}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        <span className="text-[11px] text-text-secondary tabular-nums">
                            {isAltCollateral
                                ? `Spendable: ${balanceIsLoading ? '…' : spendableUsdc.toFixed(2)}`
                                : `Balance: ${balanceLoading ? '…' : (usdcBalance != null ? usdcBalance.toFixed(2) : '0.00')}`}
                        </span>
                    </div>
                    {isAltCollateral && (
                        <div className="mb-2 text-[10px] text-text-muted">
                            Paying with <span className="text-text-secondary font-medium">{collateral.symbol}</span>
                            {' · '}{collateral.balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 4 })} {collateral.symbol} available
                            {' · '}{formatHaircut(collateral.baseHaircutBps)} haircut
                        </div>
                    )}
                    <div className="flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] border border-line/70 px-2.5 py-1.5 focus-within:border-brand/50 transition-colors">
                        <input
                            type="number"
                            inputMode="decimal"
                            data-testid="margin-input"
                            value={size}
                            onChange={e => setSize(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 min-w-0 bg-transparent text-lg font-mono text-text-primary focus:outline-none placeholder-text-muted [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-xs font-medium text-text-muted shrink-0">{amountMode === 'size' ? 'USD' : 'USDT0'}</span>
                    </div>
                    {/* Live derived counterpart so the user always sees both numbers. */}
                    <div className="flex items-center justify-between mt-1.5 text-[11px] text-text-muted tabular-nums">
                        <span>{amountMode === 'pay' ? 'Position size' : 'You pay'}</span>
                        <span className="font-mono text-text-secondary" data-testid="amount-derived">
                            {amountMode === 'pay'
                                ? `$${notionalValue.toFixed(2)}`
                                : `${sizeNum.toFixed(2)} USDT0`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        {[25, 50, 75].map((pct) => (
                            <button
                                key={pct}
                                type="button"
                                className="flex-1 py-1.5 text-[11px] font-medium rounded-lg bg-[var(--bg-secondary)] text-text-secondary hover:text-text-primary hover:bg-line/50 border border-line/30 transition-colors"
                                onClick={() => {
                                    const bal = spendableUsdc ?? 0;
                                    const payAmount = bal * (pct / 100);
                                    // % buttons always size off spendable balance (a Pay amount).
                                    // In size mode, show the equivalent notional.
                                    setSize(amountMode === 'size' ? (payAmount * leverage).toFixed(2) : payAmount.toFixed(2));
                                }}
                            >
                                {pct}%
                            </button>
                        ))}
                        <button
                            type="button"
                            className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-brand/15 text-[var(--primary)] hover:bg-brand/25 border border-brand/30 transition-colors"
                            onClick={() => {
                                const bal = isAltCollateral ? spendableUsdc : (usdcBalance ?? 0);
                                setSize(amountMode === 'size' ? (bal * leverage).toFixed(2) : bal.toFixed(4));
                            }}
                        >
                            Max
                        </button>
                    </div>
                    {sizeError && <div className="text-[10px] text-rose-500 mt-2">{sizeError}</div>}
                    {isConnected && !isAltCollateral && !balanceLoading && usdcBalance != null && usdcBalance === 0 && (
                        <Link
                            to="/settings"
                            className="mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium hover:bg-amber-500/15 transition-colors"
                        >
                            Mint test USDT0 in Settings
                        </Link>
                    )}
                </div>

                {/* Leverage Slider */}
                <div className="rounded-xl p-3.5 border border-line/60 bg-surface-3/40 shadow-sm overflow-hidden">
                    {(() => {
                        // Risk tone scales with leverage relative to this market's
                        // real max leverage: green in the low band, amber mid, red
                        // as it approaches the cap.
                        const levRatio = leverage / maxLev;
                        const levTone = levRatio >= 0.8 ? 'danger' : levRatio >= 0.5 ? 'warn' : 'safe';
                        const levColor = levTone === 'danger' ? 'var(--short)' : levTone === 'warn' ? '#f59e0b' : 'var(--long)';
                        const levBadge = levTone === 'danger' ? 'High risk' : levTone === 'warn' ? 'Elevated' : 'Conservative';
                        return (
                    <>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs text-text-secondary mb-2">
                        <span className="flex items-center gap-2">
                            Leverage
                            <span
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ color: levColor, backgroundColor: `color-mix(in srgb, ${levColor} 14%, transparent)` }}
                            >
                                {levBadge}
                            </span>
                        </span>
                        <div className="flex items-center rounded-xl overflow-hidden border border-line/60 bg-surface-3/60 w-fit shrink-0">
                            <button
                                type="button"
                                onClick={() => setLeverage(Math.max(1, leverage - 1))}
                                disabled={leverage <= 1}
                                className="flex items-center justify-center w-9 h-8 text-text-secondary hover:text-text-primary hover:bg-[var(--border-color)] disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                                aria-label="Decrease leverage"
                            >
                                <Minus className="w-3.5 h-3.5" strokeWidth={2.5} />
                            </button>
                            <div className="min-w-[3rem] text-center text-sm font-mono font-semibold py-1.5" style={{ color: levColor }}>
                                {leverage.toFixed(1)}x
                            </div>
                            <button
                                type="button"
                                onClick={() => setLeverage(Math.min(maxLev, leverage + 1))}
                                disabled={leverage >= maxLev}
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
                        max={maxLev}
                        step="1"
                        value={leverage}
                        onChange={e => setLeverage(Number(e.target.value))}
                        aria-label="Leverage"
                        aria-valuetext={`${leverage}x, ${levBadge}`}
                        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
                        style={{
                            // Risk gradient under the thumb: green → amber → red as
                            // leverage climbs toward the protocol cap.
                            background: `linear-gradient(90deg, var(--long) 0%, #f59e0b 55%, var(--short) 100%)`,
                            accentColor: levColor,
                        }}
                    />
                    <div className="flex flex-wrap justify-between sm:justify-between mt-2 gap-1.5">
                        {Array.from(new Set([0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.max(1, Math.round(maxLev * f)))))
                            .map(val => (
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
                    {/* Max safe size helper: the position notional the current balance
                        supports at this leverage (after the opening fee), one tap to apply. */}
                    {isConnected && spendableUsdc != null && spendableUsdc > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                // Use full spendable balance as the Pay amount; derive notional in size mode.
                                const bal = spendableUsdc;
                                setSize(amountMode === 'size' ? (bal * leverage).toFixed(2) : bal.toFixed(2));
                            }}
                            className="mt-2 w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-line/40 text-[11px] text-text-secondary hover:text-text-primary hover:border-brand/40 transition-colors"
                        >
                            <span>Max size at {leverage}x</span>
                            <span className="font-mono tabular-nums text-text-primary">
                                ${(spendableUsdc * leverage).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                        </button>
                    )}
                    </>
                        );
                    })()}
                </div>

                {/* TP / SL Bracket Section */}
                <div className="rounded-xl border border-line/60 bg-surface-3/40 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-3.5 py-2.5">
                        <span className="text-xs font-medium text-text-secondary">Take-Profit / Stop-Loss</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={bracketEnabled}
                            aria-label="Enable take-profit and stop-loss"
                            data-testid="bracket-toggle"
                            onClick={() => setBracketEnabled(v => !v)}
                            className={clsx(
                                'relative inline-flex items-center h-5 w-9 rounded-full p-0.5 transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                bracketEnabled ? 'bg-[var(--primary)]' : 'bg-surface-3/80 border border-line/70',
                            )}
                        >
                            <span className={clsx('h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200', bracketEnabled ? 'translate-x-4' : 'translate-x-0')} />
                        </button>
                    </div>

                    {bracketEnabled && (
                        <div className="border-t border-line/50">
                            <div className="p-3.5 space-y-3">
                                {/* Take Profit */}
                                <div>
                                        <div className="flex justify-between text-[11px] text-text-secondary mb-1">
                                            <span>Take-Profit Price</span>
                                            {tpGainPct != null && (
                                                <span className="text-[var(--long)] tabular-nums">+{tpGainPct.toFixed(1)}% PnL</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-secondary)] border border-line/70 px-2.5 py-1.5 focus-within:border-[var(--long)]/50 transition-colors">
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                data-testid="take-profit-price"
                                                value={takeProfitPrice}
                                                onChange={e => setTakeProfitPrice(e.target.value)}
                                                placeholder={side === 'long' ? 'Above entry' : 'Below entry'}
                                                className="flex-1 min-w-0 bg-transparent text-sm font-mono text-text-primary focus:outline-none placeholder-text-muted [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            <span className="text-[10px] font-medium text-text-muted shrink-0">USD</span>
                                        </div>
                                    </div>
                                    {/* Stop Loss */}
                                    <div>
                                        <div className="flex justify-between text-[11px] text-text-secondary mb-1">
                                            <span>Stop-Loss Price</span>
                                            {slLossPct != null && (
                                                <span className="text-[var(--short)] tabular-nums">{slLossPct.toFixed(1)}% PnL</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-secondary)] border border-line/70 px-2.5 py-1.5 focus-within:border-[var(--short)]/50 transition-colors">
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                data-testid="stop-loss-price"
                                                value={stopLossPrice}
                                                onChange={e => setStopLossPrice(e.target.value)}
                                                placeholder={side === 'long' ? 'Below entry' : 'Above entry'}
                                                className="flex-1 min-w-0 bg-transparent text-sm font-mono text-text-primary focus:outline-none placeholder-text-muted [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            <span className="text-[10px] font-medium text-text-muted shrink-0">USD</span>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-snug">
                                        Applied to the position on fill. {side === 'long' ? 'Long: TP above, SL below entry.' : 'Short: TP below, SL above entry.'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>


                {/* Liquidation price — the most prominent risk number in the ticket.
                    Distance bar fills (and shifts amber→red) as leverage/price approach
                    the liquidation threshold, so leveraged risk is never hidden. */}
                {sizeNum > 0 && hasLiqPrice && (() => {
                    const liqDistancePct = distanceToLiquidationPct(currentPrice, estLiqPrice, side === 'long') ?? 0;
                    // "Fill" represents proximity to liquidation: 0% distance = full bar.
                    // We treat a 25% move as the full-safe reference so the bar is
                    // sensitive in the range that actually matters for leveraged perps.
                    const proximity = Math.min(100, Math.max(0, (1 - Math.min(liqDistancePct, 25) / 25) * 100));
                    const riskTone = liqDistancePct < 5 ? 'danger' : liqDistancePct < 12 ? 'warn' : 'safe';
                    const toneClasses = riskTone === 'danger'
                        ? { ring: 'border-[var(--short)]/40', glow: 'shadow-[0_0_0_1px_var(--short)] shadow-rose-900/20', text: 'text-[var(--short)]', bar: 'bg-[var(--short)]' }
                        : riskTone === 'warn'
                            ? { ring: 'border-amber-500/40', glow: '', text: 'text-amber-400', bar: 'bg-amber-400' }
                            : { ring: 'border-line/60', glow: '', text: 'text-text-primary', bar: 'bg-[var(--long)]' };
                    const showWarning = settings.liquidationWarnings && riskTone === 'danger';
                    return (
                        <div className={clsx('rounded-xl p-3.5 border bg-surface-3/40 shadow-sm overflow-hidden transition-colors', toneClasses.ring, toneClasses.glow)}>
                            <div className="flex items-end justify-between gap-3 mb-2.5">
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold">Liquidation Price</span>
                                    <span className={clsx('text-xl font-bold font-mono tabular-nums leading-tight mt-0.5', toneClasses.text)} data-testid="liq-price">
                                        ${formatPriceWithPrecision(estLiqPrice)}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold">Distance</span>
                                    <span className={clsx('text-sm font-bold font-mono tabular-nums leading-tight mt-0.5', toneClasses.text)}>
                                        {liqDistancePct.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                            <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                                <div
                                    className={clsx('h-full rounded-full transition-all duration-300', toneClasses.bar)}
                                    style={{ width: `${proximity}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-[10px] text-text-muted mt-1.5 tabular-nums">
                                <span>Mark ${formatPriceWithPrecision(currentPrice)}</span>
                                <span>{liqDistancePct.toFixed(1)}% move to liquidation</span>
                            </div>
                            {showWarning && (
                                <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-[var(--short)]/10 border border-[var(--short)]/25 px-2.5 py-2">
                                    <AlertTriangle className="w-3.5 h-3.5 text-[var(--short)] shrink-0 mt-px" />
                                    <span className="text-[11px] leading-snug text-[var(--short)]">
                                        High liquidation risk: a {liqDistancePct.toFixed(1)}% move against you triggers liquidation. Consider lowering leverage.
                                    </span>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Overnight-gap risk warning for tokenized equities held across a
                    session close. Closed-session positions cannot be liquidated
                    until reopen. */}
                {sizeNum > 0 && !marketSession.isAlwaysOpen && (marketSession.state === 'closed' || marketSession.closingSoon) && (
                    <div className="rounded-xl p-3 border border-amber-500/30 bg-amber-500/10 shadow-sm overflow-hidden">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-amber-300">
                                        {marketSession.state === 'closed' ? 'Market closed — overnight gap risk' : 'Market closing soon — gap risk'}
                                    </span>
                                    <MarketSessionBadge category={market.category} compact />
                                </div>
                                <p className="text-[11px] leading-snug text-amber-200/80 mt-1">
                                    {market.symbol} tracks an equity that is currently {marketSession.state === 'closed' ? 'closed' : 'about to close'}. Positions held across the close
                                    {marketSession.nextChangeLabel ? ` (${marketSession.nextChangeLabel.toLowerCase()})` : ''} cannot be liquidated until the session reopens and may gap past your liquidation price. Size and leverage accordingly.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Account health (real on-chain cross-margin risk) */}
                {protocolMarginMode === 'cross' && accountRisk.hasPositions && (() => {
                    const meta = healthFactorMeta(accountRisk.healthFactor);
                    const toneClass = meta.tone === 'danger' ? 'text-[var(--short)]' : meta.tone === 'warn' ? 'text-amber-400' : 'text-[var(--long)]';
                    const hfText = Number.isFinite(accountRisk.healthFactor) ? `${accountRisk.healthFactor.toFixed(2)}` : '∞';
                    const barPct = Number.isFinite(accountRisk.healthFactor)
                        ? Math.min(100, Math.max(4, (1 / Math.max(accountRisk.healthFactor, 0.01)) * 100))
                        : 4;
                    return (
                        <div className="rounded-xl p-3.5 border border-line/60 bg-surface-3/40 shadow-sm overflow-hidden">
                            <div className="flex justify-between text-xs mb-1.5">
                                <GuidedTooltip
                                    id="account-health"
                                    title="Account Health"
                                    content="Your live cross-margin health factor from the protocol (TradingCore.getAccountRisk). Below 1.00 your account is liquidatable. All cross positions share this collateral."
                                >
                                    <span className="text-text-secondary">Account Health</span>
                                </GuidedTooltip>
                                <span className={clsx('font-mono font-semibold tabular-nums', toneClass)}>
                                    {hfText} · {meta.label}
                                </span>
                            </div>
                            <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                                <div
                                    className={clsx('h-full rounded-full transition-all', meta.tone === 'danger' ? 'bg-[var(--short)]' : meta.tone === 'warn' ? 'bg-amber-400' : 'bg-[var(--long)]')}
                                    style={{ width: `${barPct}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-[10px] text-text-muted mt-1.5 tabular-nums">
                                <span>Equity ${(accountRisk.totalCollateral + accountRisk.unrealizedPnL).toFixed(2)}</span>
                                <span>{accountRisk.crossPositionCount} cross {accountRisk.crossPositionCount === 1 ? 'position' : 'positions'}</span>
                            </div>
                        </div>
                    );
                })()}

                {/* Summary */}
                <div className="space-y-2 p-3.5 border border-line/60 bg-surface-3/40 rounded-xl shadow-sm overflow-hidden">
                    <SummaryRow label="Margin Mode" value={marginModeLabel} valueClass={protocolMarginMode === 'cross' ? 'text-[var(--primary)]' : 'text-amber-400'} />
                    <SummaryRow label="Collateral" value={`$${margin || '0.00'}`} />
                    <SummaryRow label="Pay With" value={collateral.symbol} valueClass={isAltCollateral ? 'text-indigo-300' : 'text-emerald-400'} />
                    {isAltCollateral && (
                        <SummaryRow label="Collateral Haircut" value={formatHaircut(collateral.baseHaircutBps)} valueClass="text-amber-400" />
                    )}
                    <SummaryRow label="Entry Price" value={`$${formatPriceWithPrecision(refEntryPrice)}`} />
                    <SummaryRow
                        label="Est. Liq. Price"
                        value={hasLiqPrice ? `$${formatPriceWithPrecision(estLiqPrice)}` : 'No price liq.'}
                        valueClass={side === 'long' ? "text-[var(--short)]" : "text-[var(--long)]"}
                    />
                    {bracketEnabled && tpGainPct != null && (
                        <SummaryRow label="Take-Profit" value={`$${formatPriceWithPrecision(tpNum)} (+${tpGainPct.toFixed(1)}%)`} valueClass="text-[var(--long)]" />
                    )}
                    {bracketEnabled && slLossPct != null && (
                        <SummaryRow label="Stop-Loss" value={`$${formatPriceWithPrecision(slNum)} (${slLossPct.toFixed(1)}%)`} valueClass="text-[var(--short)]" />
                    )}
                    {orderType === 'limit' && postOnly && (
                        <SummaryRow label="Time in force" value="Post-only" valueClass="text-[var(--primary)]" />
                    )}
                    <SummaryRow label="Est. Open Fee (0.1%)" value={`$${tradingFee.toFixed(2)}`} />
                    {/* Cost to hold — funding direction + magnitude, made explicit so
                        the trader knows whether they pay or earn carry before opening. */}
                    <SummaryRow
                        label="Funding (8h)"
                        value={
                            costToHold.direction === 'neutral'
                                ? 'Flat'
                                : `${costToHold.direction === 'pay' ? 'You pay' : 'You earn'} $${Math.abs(costToHold.fundingPer8h).toFixed(2)}`
                        }
                        valueClass={
                            costToHold.direction === 'pay'
                                ? 'text-[var(--short)]'
                                : costToHold.direction === 'receive'
                                    ? 'text-[var(--long)]'
                                    : 'text-text-secondary'
                        }
                    />
                    {sizeNum > 0 && (
                        <SummaryRow
                            label="Est. cost to hold 24h"
                            value={
                                costToHold.direction === 'receive'
                                    ? `$${tradingFee.toFixed(2)} fee − $${costToHold.abs24h.toFixed(2)} funding`
                                    : `$${firstDayCarry.toFixed(2)}`
                            }
                            valueClass="text-text-primary"
                        />
                    )}
                </div>
            </div>

            {/* Action Button */}
            <div className="p-3.5 border-t border-line/80 bg-[var(--bg-secondary)] shrink-0">
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
                                <button type="button" onClick={openConnectModal} className="w-full py-3.5 rounded-xl bg-[var(--primary)] text-white font-bold hover:opacity-90 transition-all duration-200 motion-safe:hover:scale-[1.01] motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
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
                    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto bg-black/75 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-trade-title">
                        <motion.div
                            ref={confirmModalRef}
                            initial={{ opacity: 0, y: 16, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 16, scale: 0.98 }}
                            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-t-2xl rounded-b-none sm:rounded-2xl max-w-sm w-full shadow-2xl relative flex flex-col max-h-[92dvh] sm:max-h-[min(90dvh,720px)] overflow-hidden"
                        >
                            <h2 id="confirm-trade-title" data-testid="confirm-modal-title" className="text-lg font-bold px-6 pt-6 pb-4 text-text-primary shrink-0">Confirm Trade</h2>
                            <div className="space-y-3 text-sm px-6 overflow-y-auto overscroll-contain custom-scrollbar">
                                <SummaryRow label="Market" value={market.symbol} />
                                <SummaryRow label="Side" value={side.toUpperCase()} valueClass={side === 'long' ? 'text-[var(--long)]' : 'text-[var(--short)]'} />
                                <SummaryRow label="Margin Mode" value={marginModeLabel} valueClass={protocolMarginMode === 'cross' ? 'text-[var(--primary)]' : 'text-amber-400'} />
                                <SummaryRow label="Notional Size" value={`$${notionalValue.toFixed(2)}`} />
                                <SummaryRow label="Leverage" value={`${leverage}x`} />
                                <SummaryRow label="Total Margin" value={`$${margin}`} />
                                <SummaryRow label="Pay With" value={collateral.symbol} valueClass={isAltCollateral ? 'text-indigo-300' : 'text-emerald-400'} />
                                {isAltCollateral && (
                                    <SummaryRow label="Collateral Haircut" value={formatHaircut(collateral.baseHaircutBps)} valueClass="text-amber-400" />
                                )}
                                <SummaryRow label="Entry Price" value={`$${formatPriceWithPrecision(refEntryPrice)}`} />
                                {bracketEnabled && tpNum > 0 && (
                                    <SummaryRow label="Take-Profit" value={`$${formatPriceWithPrecision(tpNum)}`} valueClass="text-[var(--long)]" />
                                )}
                                {bracketEnabled && slNum > 0 && (
                                    <SummaryRow label="Stop-Loss" value={`$${formatPriceWithPrecision(slNum)}`} valueClass="text-[var(--short)]" />
                                )}
                                <div className="border-t border-[var(--border-color)] pt-3 mt-3 space-y-2">
                                    <SummaryRow label="Est. Fee (0.1%)" value={`$${tradingFee.toFixed(2)}`} />
                                    <SummaryRow label="Max Slippage" value={`${settings.maxSlippage}%`} />
                                    {orderType === 'limit' && (
                                        <SummaryRow label="Time in force" value={postOnly ? 'Post-only' : 'GTC'} />
                                    )}
                                </div>
                                <div className="border-t border-[var(--border-color)] pt-3 mt-3 space-y-2">
                                    <SummaryRow
                                        label="Est. Liq. Price"
                                        value={hasLiqPrice ? `$${formatPriceWithPrecision(estLiqPrice)}` : 'No price liquidation'}
                                        valueClass="text-orange-400"
                                    />
                                    {hasLiqPrice && (
                                        <SummaryRow
                                            label="Liq. Risk"
                                            value={`${(distanceToLiquidationPct(currentPrice, estLiqPrice, side === 'long') ?? 0).toFixed(1)}% move to liquidate`}
                                            valueClass="text-orange-400"
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-3 px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 shrink-0">
                                <button
                                    onClick={() => setShowTradeConfirmModal(false)}
                                    className="flex-1 py-2.5 rounded-lg border border-[var(--border-color)] text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)]"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={executeOpenPositionFn}
                                    disabled={isPositionLoading}
                                    className={clsx(
                                        "flex-1 py-2.5 rounded-lg font-bold text-white",
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

function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
    return (
        <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-xs text-text-secondary">{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                onClick={onChange}
                className={clsx(
                    "relative inline-flex items-center h-5 w-9 rounded-full p-0.5 transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]",
                    checked ? "bg-[var(--primary)]" : "bg-surface-3/80 border border-line/70"
                )}
            >
                <span
                    className={clsx(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
                        checked ? "translate-x-4" : "translate-x-0"
                    )}
                />
            </button>
        </div>
    );
}
