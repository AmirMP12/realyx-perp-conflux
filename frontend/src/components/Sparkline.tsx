import { useMemo } from 'react';

interface SparklineProps {
  /** Array of { timestamp, value } */
  data: { timestamp: number; value: number }[];
  width?: number;
  height?: number;
  /** Green when last value >= first; red otherwise */
  positiveColor?: string;
  negativeColor?: string;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 28,
  positiveColor = 'var(--long)',
  negativeColor = 'var(--short)',
  className = '',
}: SparklineProps) {
  const { path, color } = useMemo(() => {
    if (!data.length) return { path: '', color: 'var(--text-muted)' };
    const values = data.map((d) => d.value).filter((v) => v > 0);
    if (values.length === 0) return { path: '', color: 'var(--text-muted)' };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = 2;
    const w = width - padding * 2;
    const h = height - padding * 2;
    const points = values.map((v, i) => {
      const x = padding + (i / (values.length - 1 || 1)) * w;
      const y = padding + h - ((v - min) / range) * h;
      return `${x},${y}`;
    });
    const pathD = points.length > 1 ? `M ${points.join(' L ')}` : '';
    const isPositive = values[values.length - 1] >= values[0];
    return { path: pathD, color: isPositive ? positiveColor : negativeColor };
  }, [data, width, height, positiveColor, negativeColor]);

  if (!path) {
    return (
      <div
        className={className}
        style={{ width, height }}
        aria-hidden
      />
    );
  }

  return (
    <svg
      width={width}
      height={height}
      className={className}
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
