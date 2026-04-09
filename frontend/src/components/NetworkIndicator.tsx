import { useChainId } from 'wagmi';
import { realyxChains } from '../config/wagmi';

const CHAIN_NAMES: Record<number, string> = {
    [realyxChains[0].id]: realyxChains[0].name,
    [realyxChains[1].id]: realyxChains[1].name,
};

export function NetworkIndicator() {
    const chainId = useChainId();
    const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
    const isTestnet = chainId === realyxChains[1].id;

    return (
        <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
            <span className={`w-2 h-2 rounded-full ${isTestnet ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            <span className="text-xs font-mono font-medium text-text-primary">{chainName}</span>
            {isTestnet && <span className="hidden 2xl:inline-block text-[10px] text-amber-400 font-medium">Testnet</span>}
        </div>
    );
}
