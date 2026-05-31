import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Loader2, Minus, Plus, Settings, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Address } from 'viem';

import { useSettingsStore } from '../../stores/settingsStore';
import { usePositionsStore } from '../../stores';
import { useOpenPosition, OrderType, useUSDCBalance, useMarginMode } from '../../hooks/useProgram';
import { useCollateralAssets, formatHaircut, type CollateralAsset } from '../../hooks/useCollateral';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useSound } from '../../hooks/useSound';
import { showToast } from '../ui/Toast';
import { GuidedTooltip } from '../ui/GuidedTooltip';
import { CollateralSelector } from './CollateralSelector';
import { Market } from '../../services/markets';
import { formatPriceWithPrecision } from '../../utils/format';

interface TradingFormProps {
    market: Market;
    currentPrice: number;
    onTradeSuccess?: () => void;
    side?: 'long' | 'short';
    onSideChange?: (side: 'long' | 'short') => void;
    onPriceRefresh?: () => Promise<void> | void;
    className?: string;
}

export function TradingForm({
    market,
    currentPrice,
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

    // Multi-collateral: USDC + any token registered in CollateralRegistry.
    const { assets: collateralAssets, usdc: usdcAsset, ordersEnabled: altOrdersEnabled, loading: collateralLoading } = useCollateralAssets();
    const [collateral, setCollateral] = useState<CollateralAsset>(usdcAsset);
    const isAltCollateral = !collateral.isUSDC;
    // Keep the selected collateral object in sync as registry reads resolve.
    useEffect(() => {
        const match = collateralAssets.find((a) => a.address.toLowerCase() === collateral.address.toLowerCase());
        if (match && match !== collateral) setCollateral(match);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collateralAssets]);

    const [internalSide, setInternalSide] = useState<'long' | 'short'>('long');
    const side = controlledSide ?? internalSide;
    const setSide = onSideChange ?? setInternalSide;
    const [leverage, setLeverage] = useState(settings.defaultLeverage);
    const [size, setSize] = useState('');
    const [margin, setMargin] = useState('');
    const [orderType, setOrderType] = useState<'market' | 'limit'>(settings.defaultOrderType === 'limit' ? 'limit' : 'market');
    const [triggerPrice, setTriggerPrice] = useState('');
    const [showTradeConfirmModal, setShowTradeConfirmModal] = useState(false);

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

    const sizeNum = parseFloat(size) || 0;

    // Effective USDC spending power for the chosen collateral. USDC = wallet balance;
    // alt collateral = post-haircut USDC value reported by CollateralRegistry.
    const spendableUsdc = isAltCollateral ? collateral.effectiveUsdcFormatted : usdcBalance;
    const balanceIsLoading = isAltCollateral ? collateralLoading : balanceLoading;

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
                expectedPrice: currentPrice, // Pass currentPrice so leverage/margin calculation in executePosition is accurate
                collateralToken: isAltCollateral && altOrdersEnabled ? (collateral.address as Address) : undefined,
            });

            if (success) {
                removeOptimisticPosition(tempId);
                sessionStorage.removeItem('pending_trade');
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
        <div className={clsx("flex flex-col glass-panel-elevated rounded-2xl overflow-hidden shadow-[0_24px_50px_rgba(0,0,0,0.4)] h-full", className)}>
            {/* Long / Short segmented control */}
            <div className="p-2.5 shrink-0">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-3/60 border border-line/60">
                    <button
                        type="button"
                        onClick={() => setSide('long')}
                        className={clsx(
                            "py-2.5 text-sm font-bold rounded-lg transition-all duration-200 motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-long/50",
                            side === 'long'
                                ? "bg-[var(--long)] text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)]"
                                : "text-text-secondary hover:text-[var(--long)]"
                        )}
                    >
                        Long
                    </button>
                    <button
                        type="button"
                        onClick={() => setSide('short')}
                        className={clsx(
                            "py-2.5 text-sm font-bold rounded-lg transition-all duration-200 motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-short/50",
                            side === 'short'
                                ? "bg-[var(--short)] text-white shadow-[0_4px_14px_rgba(244,63,94,0.3)]"
                                : "text-text-secondary hover:text-[var(--short)]"
                        )}
                    >
                        Short
                    </button>
                </div>
            </div>

            {/* Order Type + Margin Mode */}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-y border-line/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]">
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
                    <GuidedTooltip
                        id="margin-mode"
                        title={`${marginModeLabel} Margin`}
                        content={
                            protocolMarginMode === 'cross'
                                ? 'This deployment uses Cross margin: all your positions share collateral, improving capital efficiency but linking liquidation risk across positions.'
                                : 'This deployment uses Isolated margin: each position is collateralized and liquidated independently.'
                        }
                    >
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
                    </GuidedTooltip>
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
                    <div className="flex justify-between items-center text-xs text-text-secondary mb-2">
                        <span>Margin (USDC)</span>
                        <span className="tabular-nums">
                            {isAltCollateral
                                ? `Spendable: ${balanceIsLoading ? '…' : spendableUsdc.toFixed(2)} USDC`
                                : `Balance: ${balanceLoading ? '…' : (usdcBalance != null ? usdcBalance.toFixed(2) : '0.00')} USDC`}
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
                        <span className="text-xs font-medium text-text-muted shrink-0">USDC</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        {[25, 50, 75].map((pct) => (
                            <button
                                key={pct}
                                type="button"
                                className="flex-1 py-1.5 text-[11px] font-medium rounded-lg bg-[var(--bg-secondary)] text-text-secondary hover:text-text-primary hover:bg-line/50 border border-line/30 transition-colors"
                                onClick={() => {
                                    const bal = spendableUsdc ?? 0;
                                    setSize((bal * (pct / 100)).toFixed(2));
                                }}
                            >
                                {pct}%
                            </button>
                        ))}
                        <button
                            type="button"
                            className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-brand/15 text-[var(--primary)] hover:bg-brand/25 border border-brand/30 transition-colors"
                            onClick={() => setSize((isAltCollateral ? spendableUsdc : (usdcBalance ?? 0)).toFixed(4))}
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
                            Mint test USDC in Settings
                        </Link>
                    )}
                </div>

                {/* Leverage Slider */}
                <div className="rounded-xl p-3.5 border border-line/60 bg-surface-3/40 shadow-sm overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs text-text-secondary mb-2">
                        <GuidedTooltip id="leverage" title="Leverage" content="Higher leverage amplifies both gains and losses. Your position can be liquidated if price moves against you.">
                            <span>Leverage</span>
                        </GuidedTooltip>
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
                {sizeNum > 0 && (() => {
                    const liqDistancePct = side === 'long'
                        ? ((currentPrice - estLiqPrice) / currentPrice) * 100
                        : ((estLiqPrice - currentPrice) / currentPrice) * 100;
                    const isHighRisk = settings.liquidationWarnings && liqDistancePct > 0 && liqDistancePct < 5;
                    return (
                        <div className="rounded-xl p-3.5 border border-line/60 bg-surface-3/40 shadow-sm overflow-hidden">
                            <div className="flex justify-between text-xs text-text-secondary mb-1">
                                <span>Liquidation distance</span>
                                <span className="text-orange-400 font-medium tabular-nums">
                                    {liqDistancePct.toFixed(1)}% to liq.
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
                            {isHighRisk && (
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

                {/* Summary */}
                <div className="space-y-2 p-3.5 border border-line/60 bg-surface-3/40 rounded-xl shadow-sm overflow-hidden">
                    <SummaryRow label="Margin Mode" value={marginModeLabel} valueClass={protocolMarginMode === 'cross' ? 'text-[var(--primary)]' : 'text-amber-400'} />
                    <SummaryRow label="Collateral" value={`$${margin || '0.00'}`} />
                    <SummaryRow label="Pay With" value={collateral.symbol} valueClass={isAltCollateral ? 'text-indigo-300' : 'text-emerald-400'} />
                    {isAltCollateral && (
                        <SummaryRow label="Collateral Haircut" value={formatHaircut(collateral.baseHaircutBps)} valueClass="text-amber-400" />
                    )}
                    <SummaryRow label="Entry Price" value={`$${formatPriceWithPrecision(currentPrice)}`} />
                    <SummaryRow label="Liq. Price" value={`$${formatPriceWithPrecision(estLiqPrice)}`} valueClass={side === 'long' ? "text-[var(--short)]" : "text-[var(--long)]"} />
                    <SummaryRow label="Est. Fee (0.1%)" value={`$${tradingFee.toFixed(2)}`} />
                    <SummaryRow label="Funding / 1h" value={`${((market.fundingRate ?? 0) * 100).toFixed(4)}%`} valueClass={(market.fundingRate ?? 0) > 0 ? "text-[var(--long)]" : "text-[var(--short)]"} />
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
                                <SummaryRow label="Entry Price" value={`$${formatPriceWithPrecision(currentPrice)}`} />
                                <div className="border-t border-[var(--border-color)] pt-3 mt-3 space-y-2">
                                    <SummaryRow label="Est. Fee (0.1%)" value={`$${tradingFee.toFixed(2)}`} />
                                    <SummaryRow label="Max Slippage" value={`${settings.maxSlippage}%`} />
                                </div>
                                <div className="border-t border-[var(--border-color)] pt-3 mt-3 space-y-2">
                                    <SummaryRow label="Liq. Price" value={`$${formatPriceWithPrecision(estLiqPrice)}`} valueClass="text-orange-400" />
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
