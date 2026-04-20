import { expect, it, describe } from "@jest/globals";
import { toDecimal, toDecimal18, toDecimalProduct36 } from "../utils/format.js";

describe("Utility Coverage Restoration", () => {
    it("toDecimal", () => {
        expect(toDecimal("1000000000000")).toBe("1.000000"); // 1e12
        expect(toDecimal(1000000000000)).toBe("1.000000");
    });

    it("toDecimal18", () => {
        expect(toDecimal18("1000000000000000000")).toBe("1.000000"); // 1e18
        expect(toDecimal18(1000000000000000000n)).toBe("1.000000");
    });

    it("toDecimalProduct36", () => {
        const val = "1" + "0".repeat(36);
        expect(toDecimalProduct36(val)).toBe("1.000000");
        
        const smallVal = "5" + "0".repeat(35); // 0.5
        expect(toDecimalProduct36(smallVal)).toBe("0.500000");
    });
});
