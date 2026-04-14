import clsx from 'clsx';

interface MobileControlsProps {
    activeTab: 'chart' | 'trade' | 'positions';
    setActiveTab: (tab: 'chart' | 'trade' | 'positions') => void;
}

export function MobileControls({ activeTab, setActiveTab }: MobileControlsProps) {
    return (
        <div className="lg:hidden flex border-b border-[var(--border-color)] bg-[var(--bg-secondary)] sticky top-[64px] z-20 min-h-[44px] shadow-[0_1px_0_rgba(0,0,0,0.12)]">
            {(['chart', 'trade', 'positions'] as const).map(tab => (
                <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={clsx(
                        "flex-1 py-3 text-sm font-bold uppercase tracking-wider transition-colors duration-200 border-b-2 min-h-[44px] touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]/30",
                        activeTab === tab
                            ? "border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10"
                            : "border-transparent text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)]/40"
                    )}
                >
                    {tab}
                </button>
            ))}
        </div>
    );
}
