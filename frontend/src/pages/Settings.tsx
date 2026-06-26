import { useState } from 'react';
import { useAccount, useWriteContract, useChainId, useReadContract } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';

import {
    Bell, Shield, Sliders, Moon, Sun,
    Wallet, ExternalLink, Copy, Check, AlertTriangle,
    Zap, Globe, ChevronRight, DollarSign,
    Monitor, Radio
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useSettingsStore, SettingsState } from '../stores/settingsStore';
import { MOCK_USDT0_ADDRESS } from '../hooks/useProgram';
import { realyxChains } from '../config/wagmi';
import { NotificationSetup } from '../components/NotificationSetup';

const TESTNET_FAUCET_URL = 'https://efaucet.confluxnetwork.org/';

const CHAIN_NAMES: Record<number, string> = {
    [realyxChains[0].id]: realyxChains[0].name,
};

interface SettingsSection {
    id: string;
    title: string;
    icon: React.ElementType;
    description: string;
}

const SECTIONS: SettingsSection[] = [
    { id: 'trading', title: 'Trading', icon: Sliders, description: 'Manage leverage, slippage, and order defaults' },
    { id: 'display', title: 'Display', icon: Monitor, description: 'Customize theme and layout' },
    { id: 'notifications', title: 'Notifications', icon: Bell, description: 'Configure alerts for price and positions' },
    { id: 'security', title: 'Security', icon: Shield, description: 'Manage wallet permissions and safety' },
];

export function SettingsPage() {
    const { address, isConnected } = useAccount();
    const chainId = useChainId();
    const [activeSection, setActiveSection] = useState('trading');
    const [copied, setCopied] = useState(false);

    const settings = useSettingsStore();
    const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;

    const copyAddress = () => {
        if (address) {
            navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast.success('Address copied!');
        }
    };

    const formatAddress = (addr: string) => {
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    };

    return (
        <div className="min-h-screen pb-20 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight">Settings</h1>
                <p className="text-text-secondary mt-1 text-sm sm:text-lg">Manage your trading preferences and app configuration.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
                {/* Sidebar Navigation */}
                <div className="lg:col-span-3 space-y-6">
                    {/* Wallet Card */}
                    {isConnected && address && (
                        <div className="glass-panel p-4">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand/20 to-accent-purple/20 flex items-center justify-center border border-brand/30">
                                    <Wallet className="w-5 h-5 text-[var(--primary)]" />
                                </div>
                                <div>
                                    <div className="text-xs text-text-muted font-medium uppercase tracking-wide">Connected</div>
                                    <div className="font-mono text-sm font-bold text-text-primary">{formatAddress(address)}</div>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={copyAddress}
                                    className="flex-1 btn-ghost py-1.5 text-xs flex items-center justify-center gap-2 border border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]"
                                >
                                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    <span>Copy</span>
                                </button>
                                <a
                                    href={`https://evmtestnet.confluxscan.net/address/${address}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 btn-ghost py-1.5 text-xs flex items-center justify-center gap-2 border border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]"
                                >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>Explorer</span>
                                </a>
                            </div>
                        </div>
                    )}

                    {/* Network Status */}
                    <div className="glass-panel p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Globe className="w-5 h-5 text-text-secondary" />
                            <span className="text-sm font-medium text-text-secondary">Network</span>
                        </div>
                        <div className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-xs font-mono font-bold text-text-primary">{chainName}</span>
                        </div>
                    </div>

                    {/* Navigation Links */}
                    <div className="glass-panel p-2">
                        {SECTIONS.map((section) => (
                            <button
                                key={section.id}
                                onClick={() => setActiveSection(section.id)}
                                className={clsx(
                                    'w-full flex items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3 rounded-lg transition-all text-left relative overflow-hidden group',
                                    activeSection === section.id
                                        ? 'bg-brand/10 text-[var(--primary)] font-medium'
                                        : 'text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)]'
                                )}
                            >
                                {activeSection === section.id && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--primary)] rounded-r"
                                    />
                                )}
                                <section.icon className={clsx("w-5 h-5", activeSection === section.id ? "text-[var(--primary)]" : "text-text-muted group-hover:text-text-primary")} />
                                <div>
                                    <div className="text-sm">{section.title}</div>
                                    <div className="text-[10px] text-text-muted leading-tight mt-0.5 opacity-80">{section.description}</div>
                                </div>
                                <ChevronRight className={clsx("w-4 h-4 ml-auto transition-transform", activeSection === section.id ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-50")} />
                            </button>
                        ))}
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="lg:col-span-9 space-y-6">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeSection}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                            className="glass-panel p-6 md:p-8 min-h-[500px]"
                        >
                            {activeSection === 'trading' && <TradingSettings settings={settings} />}
                            {activeSection === 'notifications' && <NotificationSettings settings={settings} />}
                            {activeSection === 'security' && <SecuritySettings settings={settings} />}
                            {activeSection === 'display' && <DisplaySettings settings={settings} />}
                        </motion.div>
                    </AnimatePresence>

                    {/* Testnet Tools (Only visible on testnets) */}
                    {(chainId === realyxChains[0].id || !isConnected) && (
                        <TestnetSettings />
                    )}
                </div>
            </div>
        </div>
    );
}

const MOCK_USDT0_ABI = [
    { inputs: [], name: 'faucet', outputs: [], stateMutability: 'nonpayable', type: 'function' },
    { inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }], name: 'mint', outputs: [], stateMutability: 'nonpayable', type: 'function' },
    { inputs: [], name: 'MAX_MINT_PER_WALLET', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [{ internalType: 'address', name: '', type: 'address' }], name: 'mintedAmount', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

function getMockUsdt0Address(chainId: number, usdt0FromCore: Address | undefined): Address | undefined {
    if (usdt0FromCore) return usdt0FromCore;
    if (chainId === realyxChains[0].id) return MOCK_USDT0_ADDRESS;
    return undefined;
}

const TestnetSettings = () => {
    const { address, isConnected } = useAccount();
    const chainId = useChainId();
    const { writeContractAsync } = useWriteContract();
    const [loading, setLoading] = useState(false);

    const mintUsdt0Address = getMockUsdt0Address(chainId, undefined);

    const { data: balance } = useReadContract({
        address: mintUsdt0Address,
        abi: [{ inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }] as const,
        functionName: 'balanceOf',
        args: [address!],
        query: {
            enabled: !!address && !!mintUsdt0Address,
        }
    });

    const hasBalance = balance !== undefined && balance > 0n;

    const { data: maxMint } = useReadContract({
        address: mintUsdt0Address,
        abi: MOCK_USDT0_ABI,
        functionName: 'MAX_MINT_PER_WALLET',
        query: { enabled: !!mintUsdt0Address }
    });

    const { data: mintedAmount } = useReadContract({
        address: mintUsdt0Address,
        abi: MOCK_USDT0_ABI,
        functionName: 'mintedAmount',
        args: [address!],
        query: { enabled: !!mintUsdt0Address && !!address }
    });

    const mintLimitReached = maxMint && mintedAmount && mintedAmount >= maxMint;

    let buttonLabel = 'Mint 1,000 Mock USDT0';
    let buttonDisabled = false;

    if (!isConnected) {
        buttonDisabled = true;
        buttonLabel = 'Connect Wallet';
    } else if (loading) {
        buttonDisabled = true;
        buttonLabel = 'Minting...';
    } else if (mintLimitReached) {
        buttonDisabled = true;
        buttonLabel = 'Max Limit Reached (1k/User)';
    }

    const handleFaucet = () => {
        window.open(TESTNET_FAUCET_URL, '_blank', 'noopener,noreferrer');
        toast.success('Opened Conflux faucet');
    };

    const handleMintMockUSDT0 = async () => {
        if (!address || !mintUsdt0Address) {
            toast.error('Connect wallet first');
            return;
        }
        setLoading(true);
        const toastId = toast.loading('Minting Mock USDT0...');
        try {
            await writeContractAsync({
                address: mintUsdt0Address as Address,
                abi: MOCK_USDT0_ABI,
                functionName: 'faucet',
                args: [],
            });
            toast.success('Minted! Check your wallet.', { id: toastId });
        } catch (e: unknown) {
            console.error('Mint USDT0 error:', e);
            const msg = String((e as { message?: string })?.message ?? '').toLowerCase();
            if (msg.includes('user rejected') || msg.includes('user denied')) {
                toast.error('Transaction rejected', { id: toastId });
            } else {
                toast.error('Mint failed. You may have already minted.', { id: toastId });
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="glass-panel p-6 border-l-4 border-l-[var(--primary)] relative overflow-hidden animate-in fade-in duration-500">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <Zap className="w-32 h-32" />
            </div>
            <h2 className="text-lg font-bold mb-2 flex items-center gap-2 text-[var(--primary)]">
                <Zap className="w-5 h-5" />
                Testnet Tools
            </h2>
            <div className="mb-6 max-w-2xl">
                <p className="text-text-secondary text-sm">
                    You are on Conflux Testnet. Use these tools to get test assets (CFX for gas, Mock USDT0 for trading).
                </p>
                {hasBalance && (
                    <div className="mt-2 text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded w-fit">
                        Balance: {formatUnits(balance as bigint, 6)} USDT0
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-4 relative z-10">
                <button onClick={handleFaucet} className="btn-secondary py-2 px-4 flex items-center gap-2 text-sm">
                    <Globe className="w-4 h-4" />
                    <span>Get Testnet CFX</span>
                </button>
                <button
                    onClick={handleMintMockUSDT0}
                    disabled={buttonDisabled}
                    className={clsx(
                        "btn-primary py-2 px-4 flex items-center gap-2 text-sm",
                        buttonDisabled && "opacity-50 cursor-not-allowed hover:bg-[var(--primary)]"
                    )}
                >
                    <DollarSign className="w-4 h-4" />
                    <span>{buttonLabel}</span>
                </button>
                <a
                    href={chainId === realyxChains[0].id && mintUsdt0Address ? `https://evmtestnet.confluxscan.net/address/${mintUsdt0Address}#writeContract` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={clsx(
                        "btn-secondary py-2 px-4 flex items-center gap-2 text-sm",
                        (!mintUsdt0Address || chainId !== realyxChains[0].id) && "pointer-events-none opacity-50"
                    )}
                >
                    <ExternalLink className="w-4 h-4" />
                    <span>Mint via Scan</span>
                </a>
            </div>
        </div>
    );
}

function SectionHeader({ title, description }: { title: string, description: string }) {
    return (
        <div className="mb-8 pb-4 border-b border-[var(--border-color)]">
            <h2 className="text-xl font-bold text-text-primary">{title}</h2>
            <p className="text-text-secondary text-sm mt-1">{description}</p>
        </div>
    );
}

function TradingSettings({ settings }: { settings: SettingsState }) {
    const onSelect = (key: string, value: number | string | boolean) => {
        if (key === 'leverage') settings.setDefaultLeverage(value as number);
        if (key === 'slippage') settings.setMaxSlippage(value as number);
        if (key === 'orderType') settings.setDefaultOrderType(value as 'market' | 'limit');
        if (key === 'confirmTrades') settings.setConfirmTrades(value as boolean);
        if (key === 'autoCloseOnLiquidation') settings.setAutoCloseOnLiquidation(value as boolean);
    };

    return (
        <div className="space-y-8">
            <SectionHeader title="Trading Preferences" description="Configure your default trading parameters and safeguards." />

            {/* Default Leverage */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-text-primary">Default Leverage</label>
                    <span className="font-mono text-[var(--primary)] font-bold bg-brand/10 px-3 py-1 rounded">{settings.defaultLeverage}x</span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={settings.defaultLeverage}
                    onChange={(e) => onSelect('leverage', parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
                />
                <div className="flex justify-between text-xs text-text-muted font-mono">
                    <span>1x</span>
                    <span>50x</span>
                    <span>100x</span>
                </div>
            </div>

            {/* Max Slippage */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-text-primary block">Max Slippage</label>
                <div className="flex flex-wrap gap-2">
                    {[0.1, 0.5, 1.0, 2.0].map((val) => (
                        <button
                            key={val}
                            onClick={() => onSelect('slippage', val)}
                            className={clsx(
                                "px-4 py-2 rounded-lg text-sm font-mono font-medium transition-all border",
                                settings.maxSlippage === val
                                    ? "bg-[var(--primary)] text-white border-[var(--primary)] shadow-lg shadow-brand/20"
                                    : "bg-[var(--bg-tertiary)] text-text-secondary border-transparent hover:border-[var(--border-color)] hover:text-text-primary"
                            )}
                        >
                            {val}%
                        </button>
                    ))}
                </div>
                <p className="text-xs text-text-muted">High slippage tolerance can help trades execute in volatile markets.</p>
            </div>

            {/* Order Type */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-text-primary block">Default Order Type</label>
                <div className="grid grid-cols-2 gap-4 max-w-md">
                    {(['market', 'limit'] as const).map((type) => (
                        <button
                            key={type}
                            onClick={() => onSelect('orderType', type)}
                            className={clsx(
                                "px-4 py-3 rounded-xl text-sm font-medium transition-all border text-left flex items-center justify-between group",
                                settings.defaultOrderType === type
                                    ? "bg-brand/10 border-brand/50 text-[var(--primary)]"
                                    : "bg-[var(--bg-tertiary)] border-transparent text-text-secondary hover:text-text-primary"
                            )}
                        >
                            <span className="capitalize">{type}</span>
                            {settings.defaultOrderType === type && <Check className="w-4 h-4" />}
                        </button>
                    ))}
                </div>
            </div>

            <div className="pt-4 border-t border-[var(--border-color)] space-y-4">
                <ToggleSetting
                    label="Confirm trades"
                    description="Show a confirmation modal before submitting any transaction."
                    value={settings.confirmTrades}
                    onChange={(val) => onSelect('confirmTrades', val)}
                />
                <ToggleSetting
                    label="Auto-close on liquidation (Coming Soon)"
                    description="Automatically close positions when approaching liquidation."
                    value={false}
                    onChange={() => { }}
                    disabled
                />
            </div>
        </div>
    );
}

function NotificationSettings({ settings }: { settings: SettingsState }) {
    return (
        <div className="space-y-8">
            <SectionHeader title="Notifications" description="Enable off-app alerts and install Realyx as an app." />

            <NotificationSetup />

            <div className="space-y-1">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Alert types</h3>
                <p className="text-[11px] text-text-muted mb-4">
                    Control which events trigger an alert. Liquidation warnings are active now and drive the in-app risk banner on the trade form. Remaining alert types are coming soon.
                </p>
            </div>

            {/* Liquidation warnings is a live setting consumed by the trade form's risk banner */}
            <ToggleSetting
                label="Liquidation warnings"
                description="Show critical risk warnings when a position approaches liquidation."
                value={settings.liquidationWarnings}
                onChange={(val) => settings.setLiquidationWarnings(val)}
                important
                icon={AlertTriangle}
            />

            <div className="space-y-4 opacity-60 pointer-events-none">
                <ToggleSetting
                    label="Position alerts (Coming Soon)"
                    description="Get notified when orders are filled or closed."
                    value={false}
                    onChange={() => { }}
                    icon={Bell}
                    disabled
                />
                <ToggleSetting
                    label="Price alerts (Coming Soon)"
                    description="Receive alerts for significant price movements."
                    value={false}
                    onChange={() => { }}
                    icon={Radio}
                    disabled
                />
                <ToggleSetting
                    label="Funding rate reminders (Coming Soon)"
                    description="Get notified before hourly funding payments."
                    value={false}
                    onChange={() => { }}
                    icon={DollarSign}
                    disabled
                />
            </div>
        </div>
    );
}

function SecuritySettings({ settings }: { settings: SettingsState }) {
    const onSelect = (key: string, value: boolean) => {
        if (key === 'requireConfirmation') {
            settings.setRequireConfirmation(value);
            settings.setConfirmTrades(value);
        }
        if (key === 'whitelistAddresses') settings.setWhitelistAddresses(value);
    };

    return (
        <div className="space-y-8">
            <SectionHeader title="Security" description="Enhance the security of your trading session." />

            <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl mb-6 flex items-start gap-3">
                <Shield className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                    <div className="font-bold text-orange-500 text-sm">Security Notice</div>
                    <p className="text-xs text-orange-400/90 mt-1 leading-relaxed">
                        Never share your private key or seed phrase. Realyx will never ask for your credentials.
                        Ensure you are on the official domain.
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <ToggleSetting
                    label="Review transactions"
                    description="Always review transaction details before signing in wallet."
                    value={settings.requireConfirmation}
                    onChange={(val) => onSelect('requireConfirmation', val)}
                    icon={Check}
                />
                <ToggleSetting
                    label="2FA (Coming Soon)"
                    description="Two-factor authentication for withdrawals."
                    value={false}
                    onChange={() => { }}
                    disabled
                    icon={Shield}
                />
                <ToggleSetting
                    label="Whitelist addresses (Coming Soon)"
                    description="Only allow withdrawals to whitelisted addresses."
                    value={false}
                    onChange={() => { }}
                    disabled
                    icon={Shield}
                />
            </div>
        </div>
    );
}

function DisplaySettings({ settings }: { settings: SettingsState }) {
    const onSelect = (key: string, value: any) => {
        if (key === 'compactMode') settings.setCompactMode(value);
        if (key === 'showPnlPercent') settings.setShowPnlPercent(value);
    };

    return (
        <div className="space-y-8">
            <SectionHeader title="Display" description="Customize the appearance of the trading interface." />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                    onClick={() => settings.setTheme('dark')}
                    className={clsx(
                        "p-4 rounded-xl border text-left transition-all",
                        settings.theme === 'dark'
                            ? "bg-brand/10 border-[var(--primary)] shadow-lg shadow-brand/10"
                            : "bg-[var(--bg-tertiary)] border-transparent hover:border-[var(--border-color)]"
                    )}
                >
                    <div className="flex justify-between items-start mb-2">
                        <Moon className={clsx("w-6 h-6", settings.theme === 'dark' ? "text-[var(--primary)]" : "text-text-muted")} />
                        {settings.theme === 'dark' && <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />}
                    </div>
                    <div className="font-medium text-text-primary">Dark Mode</div>
                    <div className="text-xs text-text-muted mt-1">Default dark theme</div>
                </button>

                <button
                    onClick={() => settings.setTheme('light')}
                    className={clsx(
                        "p-4 rounded-xl border text-left transition-all",
                        settings.theme === 'light'
                            ? "bg-brand/10 border-[var(--primary)] shadow-lg shadow-brand/10"
                            : "bg-[var(--bg-tertiary)] border-transparent hover:border-[var(--border-color)]"
                    )}
                >
                    <div className="flex justify-between items-start mb-2">
                        <Sun className={clsx("w-6 h-6", settings.theme === 'light' ? "text-[var(--primary)]" : "text-text-muted")} />
                        {settings.theme === 'light' && <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />}
                    </div>
                    <div className="font-medium text-text-primary">Light Mode</div>
                    <div className="text-xs text-text-muted mt-1">Bright, high-contrast theme</div>
                </button>
            </div>

            <div className="pt-4 border-t border-[var(--border-color)] space-y-4">
                <ToggleSetting
                    label="Compact mode"
                    description="Reduce spacing in tables and lists."
                    value={settings.compactMode}
                    onChange={(val) => onSelect('compactMode', val)}
                />
                <ToggleSetting
                    label="Show PnL as %"
                    description="Prefer percentage over absolute value for PnL."
                    value={settings.showPnlPercent}
                    onChange={(val) => onSelect('showPnlPercent', val)}
                />
            </div>
        </div>
    );
}

function ToggleSetting({
    label,
    description,
    value,
    onChange,
    disabled = false,
    important = false,
    icon: Icon
}: {
    label: string,
    description: string,
    value: boolean,
    onChange: (val: boolean) => void,
    disabled?: boolean,
    important?: boolean,
    icon?: React.ElementType
}) {
    return (
        <div className={clsx(
            "flex items-center justify-between p-4 rounded-xl transition-all border",
            important ? "bg-rose-500/5 border-rose-500/20" : "bg-[var(--bg-tertiary)] border-transparent hover:border-[var(--border-color)]",
            disabled && "opacity-50 cursor-not-allowed"
        )}>
            <div className="flex items-start gap-4">
                {Icon && (
                    <div className={clsx("p-2 rounded-lg", important ? "bg-rose-500/10 text-rose-500" : "bg-[var(--bg-secondary)] text-text-secondary")}>
                        <Icon className="w-5 h-5" />
                    </div>
                )}
                <div>
                    <div className={clsx("font-medium", important ? "text-rose-500" : "text-text-primary")}>{label}</div>
                    <div className="text-xs text-text-secondary mt-0.5">{description}</div>
                </div>
            </div>

            <button
                onClick={() => !disabled && onChange(!value)}
                className={clsx(
                    "w-12 h-6 rounded-full relative transition-colors duration-300",
                    value
                        ? (important ? "bg-rose-500" : "bg-[var(--primary)]")
                        : "bg-[var(--bg-secondary)]"
                )}
                disabled={disabled}
            >
                <div
                    className={clsx(
                        "w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all duration-300 shadow-sm",
                        value ? "left-[26px]" : "left-0.5"
                    )}
                />
            </button>
        </div>
    );
}
