const USDC_DECIMALS = 6;
const PRECISION_1E12 = 1e12;

/** Divide a raw 1e12-scaled value to a human-readable decimal string. */
export function toDecimal(raw: string): string {
  return (Number(raw) / PRECISION_1E12).toFixed(USDC_DECIMALS);
}

export const PRECISION_1E18 = 1e18;

/** Divide a raw 1e18-scaled value (on-chain sizes, prices, OI, PnL) to a human-readable decimal string. */
export function toDecimal18(raw: string): string {
  return (Number(raw) / PRECISION_1E18).toFixed(USDC_DECIMALS);
}

/**
 * Divide product of two 1e18 values (e.g. size × price) to a human-readable USD string.
 * (1e18 × 1e18 = 1e36) → divide by 1e36.
 */
export function toDecimalProduct36(raw: string): string {
  // Use BigInt-safe division to avoid floating point overflow for very large numbers
  const n = BigInt(raw.split('.')[0]); // truncate any fractional part
  const divisor = BigInt("1000000000000000000000000000000000000"); // 1e36
  const whole = n / divisor;
  const remainder = n % divisor;
  const frac = Number(remainder) / 1e36;
  return (Number(whole) + frac).toFixed(USDC_DECIMALS);
}
