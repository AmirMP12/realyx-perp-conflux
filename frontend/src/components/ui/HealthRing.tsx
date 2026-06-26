import clsx from 'clsx';

interface HealthRingProps {
    /** Health factor where 1.0 is the liquidation threshold; Infinity = no risk. */
    healthFactor: number;
    /** Optional sub-label under the value (e.g. "3 cross positions"). */
    caption?: string;
    size?: number;
    className?: string;
}

/**
 * Account-health gauge: a single ring that fills toward the liquidation
 * threshold and shifts green → amber → red as the cross-margin account
 * approaches liquidation (health factor → 1.0). This is the emotional anchor of
 * the portfolio view — one glance answers "how close am I to being liquidated?".
 *
 * The fill maps the health factor onto a 0–100% arc: HF ≥ 3 reads as full/safe,
 * HF = 1 (liquidation) reads as nearly empty/red. Respects reduced motion via a
 * plain CSS transition (no JS animation loop).
 */
export function HealthRing({ healthFactor, caption, size = 132, className }: HealthRingProps) {
    const isInfinite = !Number.isFinite(healthFactor);
    // Map HF∈[1,3] → fill∈[8%,100%]; clamp outside. Below 1 the account is
    // liquidatable, so we floor the visible arc at a small sliver.
    const hf = isInfinite ? 3 : healthFactor;
    const fillPct = isInfinite ? 100 : Math.max(4, Math.min(100, ((hf - 1) / (3 - 1)) * 100));

    const tone = isInfinite || hf >= 1.5 ? 'safe' : hf >= 1.1 ? 'warn' : 'danger';
    const color = tone === 'danger' ? 'var(--short)' : tone === 'warn' ? '#f59e0b' : 'var(--long)';
    const label = tone === 'danger' ? 'At risk' : tone === 'warn' ? 'Caution' : 'Healthy';

    const stroke = 10;
    const r = (size - stroke) / 2;
    const circumference = 2 * Math.PI * r;
    const dash = (fillPct / 100) * circumference;
    const valueText = isInfinite ? '∞' : hf.toFixed(2);

    return (
        <div
            className={clsx('relative inline-flex items-center justify-center', className)}
            style={{ width: size, height: size }}
            role="img"
            aria-label={`Account health factor ${valueText}, ${label}`}
        >
            <svg width={size} height={size} className="-rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke="var(--bg-secondary)"
                    strokeWidth={stroke}
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${circumference}`}
                    style={{ transition: 'stroke-dasharray 500ms ease, stroke 300ms ease' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold">Health</span>
                <span className="text-2xl font-bold font-mono tabular-nums leading-none mt-0.5" style={{ color }}>
                    {valueText}
                </span>
                <span className="text-[11px] font-semibold mt-1" style={{ color }}>{label}</span>
                {caption && <span className="text-[10px] text-text-muted mt-0.5 tabular-nums">{caption}</span>}
            </div>
        </div>
    );
}
