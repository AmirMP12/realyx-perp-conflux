import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { BreakerType } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const MARKET = "0x00000000000000000000000000000000000000B7";

async function coverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

describe("CircuitBreakerLib", () => {
    // When the price has not dropped (currentPrice >= refPrice) the drop block
    // is skipped and the breaker does not trigger.
    it("checkPriceDropBreaker returns false when price did not drop", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
        // currentPrice (110) >= refPrice (100) -> no drop -> returns false without triggering.
        const triggered = await h.testCheckPriceDropBreaker.staticCall(MARKET, e18(110), e18(100));
        expect(triggered).to.equal(false);
    });

    // When the spot is below the TWAP the deviation is measured as
    // twap - currentPrice.
    it("checkTWAPDeviationBreaker handles a spot below the TWAP", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.TWAP_DEVIATION, 500, 900, 600); // 5%
        // currentPrice (80) < twap (100) -> measures twap - currentPrice;
        // 20% deviation > 5% threshold -> triggers.
        const triggered = await h.testCheckTWAPDeviationBreaker.staticCall(MARKET, e18(80), e18(100));
        expect(triggered).to.equal(true);
    });

    // An already-triggered breaker that is re-checked (threshold still exceeded)
    // must not re-trigger.
    it("a re-check of an already-triggered breaker does not re-trigger", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
        // First real check: 20% drop -> triggers and persists TRIGGERED state.
        await h.testCheckPriceDropBreaker(MARKET, e18(80), e18(100));
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(false);
        // Second check with the threshold still exceeded: the breaker is already
        // TRIGGERED so it is not re-triggered, but still reports true.
        const again = await h.testCheckPriceDropBreaker.staticCall(MARKET, e18(80), e18(100));
        expect(again).to.equal(true);
    });
});
