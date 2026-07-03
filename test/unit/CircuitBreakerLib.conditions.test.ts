import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { BreakerType } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const MARKET = "0x00000000000000000000000000000000000000B7";

async function deployCoverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

describe("CircuitBreakerLib", () => {
    it("checkPriceDropBreaker returns false when price did not drop", async () => {
        const h = await loadFixture(deployCoverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
        const triggered = await h.testCheckPriceDropBreaker.staticCall(MARKET, e18(110), e18(100));
        expect(triggered).to.equal(false);
    });

    it("checkTWAPDeviationBreaker handles a spot below the TWAP", async () => {
        const h = await loadFixture(deployCoverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.TWAP_DEVIATION, 500, 900, 600);
        const triggered = await h.testCheckTWAPDeviationBreaker.staticCall(MARKET, e18(80), e18(100));
        expect(triggered).to.equal(true);
    });

    it("a re-check of an already-triggered breaker does not re-trigger", async () => {
        const h = await loadFixture(deployCoverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
        await h.testCheckPriceDropBreaker(MARKET, e18(80), e18(100));
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(false);
        const again = await h.testCheckPriceDropBreaker.staticCall(MARKET, e18(80), e18(100));
        expect(again).to.equal(true);
    });
});
