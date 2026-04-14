export function NetworkIndicator() {
    return (
        <div className="hidden sm:flex h-9 items-center gap-2 px-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
            <img
                src="https://raw.githubusercontent.com/Conflux-Chain/design-resource-lab/master/0.%20CONFLUX%20LOGO/Logo%20Symbol/no%20space/Logo%20Symbol_no%20space_PNG/Logo%20Mark/White.png"
                alt="Conflux"
                className="w-3.5 h-3.5 object-contain"
            />
            <span className="text-xs font-medium text-text-primary">Conflux</span>
        </div>
    );
}
