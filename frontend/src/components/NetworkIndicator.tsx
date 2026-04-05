import { useChainId } from 'wagmi';
import { confluxESpace, confluxESpaceTestnet } from 'wagmi/chains';

const CHAIN_NAMES: Record<number, string> = {
    [confluxESpace.id]: 'Conflux eSpace',
    [confluxESpaceTestnet.id]: 'Conflux Testnet',
};

export function NetworkIndicator() {
    const chainId = useChainId();
    const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
    const isTestnet = chainId === confluxESpaceTestnet.id;

    return (
        <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
            <span className={`w-2 h-2 rounded-full ${isTestnet ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            <span className="text-xs font-mono font-medium text-text-primary">{chainName}</span>
            {isTestnet && <span className="text-[10px] text-amber-400 font-medium">Testnet</span>}
        </div>
    );
}
