import clsx from 'clsx';

interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
    return (
        <div
            className={clsx(
                "relative overflow-hidden rounded-md bg-[var(--bg-tertiary)]",
                "before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/5 before:to-transparent",
                className
            )}
        />
    );
}

export default Skeleton;
