import { CATEGORY_CONFIG } from '../../config/markets';

interface CategoryTagProps {
    category?: string;
    size?: 'sm' | 'xs';
}

export function CategoryTag({ category, size = 'sm' }: CategoryTagProps) {
    const cfg = category ? CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.CRYPTO : CATEGORY_CONFIG.CRYPTO;
    const textClass = size === 'xs' ? 'text-[8px] px-1.5 py-0.5' : 'text-[9px] px-2 py-0.5';
    return (
        <span
            className={`inline-flex items-center rounded-md font-bold uppercase tracking-wider border leading-none transition-all duration-200 hover:brightness-110 ${textClass} ${cfg.className}`}
        >
            {cfg.label}
        </span>
    );
}
