import { toDecimal, PRECISION_1E18 } from "../utils/format.js";

describe("Format Utils", () => {
    it("toDecimal should convert large string numbers to decimal precision strings", () => {
        expect(toDecimal("1000000000000")).toBe("1.000000");
        expect(toDecimal("500000")).toBe("0.000000"); // 1e12 scale
        expect(toDecimal("0")).toBe("0.000000");
    });

    it("PRECISION_1E18 should be correct", () => {
        expect(PRECISION_1E18).toBe(1e18);
    });
});
