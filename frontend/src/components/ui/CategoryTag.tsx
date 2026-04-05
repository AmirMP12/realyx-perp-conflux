import { CATEGORY_CONFIG } from '../../config/markets';

interface CategoryTagProps {
    category?: string;
    size?: 'sm' | 'xs';
}

export function CategoryTag({ category, size = 'sm' }: CategoryTagProps) {
    const cfg = category ? CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.CRYPTO : CATEGORY_CONFIG.CRYPTO;
    const textClass = size === 'xs' ? 'text-[9px]' : 'text-[10px]';
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded font-semibold uppercase tracking-wider border ${textClass} ${cfg.className}`}
        >
            {cfg.label}
        </span>
    );
}
