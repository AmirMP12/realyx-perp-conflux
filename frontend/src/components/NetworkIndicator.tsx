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
        <div className="hidden sm:flex h-9 items-center gap-2 px-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
            <img 
                src="https://raw.githubusercontent.com/Conflux-Chain/design-resource-lab/master/0.%20CONFLUX%20LOGO/Logo%20Symbol/no%20space/Logo%20Symbol_no%20space_PNG/Logo%20Mark/White.png" 
                alt="Conflux" 
                className={`w-3.5 h-3.5 object-contain ${isTestnet ? 'animate-pulse' : ''}`} 
            />
            <span className="text-xs font-mono font-medium text-text-primary">{isTestnet ? 'conflux' : chainName}</span>
            {isTestnet && <span className="text-[10px] text-amber-400 font-medium">testnet</span>}
        </div>
    );
}
