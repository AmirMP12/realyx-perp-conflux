import clsx from 'clsx';

interface MobileControlsProps {
    activeTab: 'chart' | 'trade' | 'positions';
    setActiveTab: (tab: 'chart' | 'trade' | 'positions') => void;
}

export function MobileControls({ activeTab, setActiveTab }: MobileControlsProps) {
    return (
        <div className="lg:hidden flex border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/50 backdrop-blur-md sticky top-[64px] z-20 min-h-[44px]">
            {(['chart', 'trade', 'positions'] as const).map(tab => (
                <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={clsx(
                        "flex-1 py-3 text-sm font-bold uppercase tracking-wider transition-all duration-200 border-b-2 min-h-[44px] touch-manipulation",
                        activeTab === tab
                            ? "border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10"
                            : "border-transparent text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)]/30"
                    )}
                >
                    {tab}
                </button>
            ))}
        </div>
    );
}
