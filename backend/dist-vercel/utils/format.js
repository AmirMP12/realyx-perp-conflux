const USDC_DECIMALS = 6;
const PRECISION_1E12 = 1e12;
export function toDecimal(raw) {
    return (Number(raw) / PRECISION_1E12).toFixed(USDC_DECIMALS);
}
export const PRECISION_1E18 = 1e18;
