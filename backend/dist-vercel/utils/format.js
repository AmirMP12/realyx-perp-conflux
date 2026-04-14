"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRECISION_1E18 = void 0;
exports.toDecimal = toDecimal;
const USDC_DECIMALS = 6;
const PRECISION_1E12 = 1e12;
function toDecimal(raw) {
    return (Number(raw) / PRECISION_1E12).toFixed(USDC_DECIMALS);
}
exports.PRECISION_1E18 = 1e18;
