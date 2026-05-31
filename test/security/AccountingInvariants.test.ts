import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { openMarket, closeFull } from "../helpers/trading";
import { usdc } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

/**
 * Regression tests for the audit fixes to VaultCore LP accounting.
 *
 * Finding 1 (HIGH): LP-earned fees and realized trader losses must NOT be
 * reclassifiable as external "donations" by `recordDonation`. The `_lpAssets`
 * counter is kept in lock-step with the real LP cash slice across
 * borrow / repay / LP-fee receipt, so `recordDonation` can only ever capture
 * genuinely untracked external transfers.
 */
describe("Accounting invariants — VaultCore LP slice vs donations", () => {
    it("recordDonation does NOT capture LP fee income or realized trader losses", async () => {
        const d = await loadFixture(deployConfigured);

        // Open a leveraged long, then close it at a LOSS so the vault retains
        // collateral + realized loss, and fees flow to the LP slice.
        const posId = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(50_000),
            collateralUsdc: usdc(10_000),
        });

        await time.increase(120);
        // Move price down 5% so the long realizes a loss into the vault.
        await setPythPrice(d.pyth, d.feedId, 47_500n * 10n ** 18n);
        await closeFull(d, d.alice, posId);

        // After a full round-trip with fees + trader loss retained by the
        // vault, any "donation" detected must be ~0 (no LP earnings captured).
        const donated = await d.vault.recordDonation.staticCall();
        expect(donated).to.equal(0n);
    });

    it("genuine external transfers are still detected as donations", async () => {
        const d = await loadFixture(deployConfigured);
        // A real, untracked external transfer must still be captured.
        await d.usdc.mintTo(d.alice.address, usdc(1_000));
        await d.usdc.connect(d.alice).transfer(await d.vault.getAddress(), usdc(1_000));
        const donated = await d.vault.recordDonation.staticCall();
        expect(donated).to.equal(usdc(1_000));
    });
});
