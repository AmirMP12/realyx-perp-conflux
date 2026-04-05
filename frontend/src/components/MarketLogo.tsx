import { useState } from "react";

type MarketLogoProps = {
  src: string | undefined;
  symbol: string;
  name?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
};

const sizeClasses = { sm: "w-4 h-4 text-xs", md: "w-6 h-6 text-sm", lg: "w-8 h-8 text-base" };

/** Market logo with fallback to initials when image fails to load (e.g. Clearbit/CORS). */
export function MarketLogo({ src, symbol, name, className = "", size = "md" }: MarketLogoProps) {
  const [errored, setErrored] = useState(false);
  const showImage = src && !errored;

  const initials = (() => {
    const s = (symbol || name || "?").replace(/-USD$/, "").trim();
    if (s.length >= 2) return s.slice(0, 2).toUpperCase();
    return s.slice(0, 1).toUpperCase() || "?";
  })();

  if (showImage) {
    return (
      <img
        src={src}
        alt={name || symbol || 'Market logo'}
        className={`object-contain ${sizeClasses[size]} ${className}`}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-[var(--bg-tertiary)] font-semibold text-[var(--text-muted)] ${sizeClasses[size]} ${className}`}
      title={name || symbol}
    >
      {initials}
    </span>
  );
}
