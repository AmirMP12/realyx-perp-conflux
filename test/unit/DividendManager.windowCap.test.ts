import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function deploy() {
    const [admin, manager, stranger] = await ethers.getSigners();
    const DividendManager = await ethers.getContractFactory("DividendManager");
    const dm = await upgrades.deployProxy(DividendManager, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await dm.waitForDeployment();
    return { dm, admin, manager, stranger };
}

/**
 * Verifies the rolling-window distribution cap and `setDividendLimits`:
 *   - distributeDividend with the cap disabled (maxDividendPerWindow == 0)
 *   - distributeDividend rejecting a distribution that exceeds the cap
 *   - distributeDividend resetting the window once its duration has elapsed
 *   - setDividendLimits admin-gating and its zero-windowDuration revert
 *   - the upgrade timelock when no implementation is staged
 *   - the re-initialization revert
 */
describe("DividendManager — rolling-window cap & limits", () => {
    describe("setDividendLimits", () => {
        it("reverts InvalidWindowDuration when windowDuration is zero", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.setDividendLimits(0, e18(1))).to.be.revertedWithCustomError(
                dm,
                "InvalidWindowDuration",
            );
        });

        it("is admin-gated (non-admin reverts)", async () => {
            const { dm, stranger } = await loadFixture(deploy);
            await expect(dm.connect(stranger).setDividendLimits(3600, e18(1))).to.be.reverted;
        });

        it("updates the window duration and cap and emits", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.setDividendLimits(7200, e18(5)))
                .to.emit(dm, "DividendLimitsUpdated")
                .withArgs(7200, e18(5));
            expect(await dm.dividendWindowDuration()).to.equal(7200n);
            expect(await dm.maxDividendPerWindow()).to.equal(e18(5));
        });
    });

    describe("distributeDividend window accounting", () => {
        it("reverts DividendWindowCapExceeded when cumulative exceeds the cap", async () => {
            const { dm } = await loadFixture(deploy);
            await dm.setDividendLimits(1 * 24 * 3600, e18(1));
            // first distribution within the cap
            await dm.distributeDividend("AAPL", e18(1));
            // a second distribution in the same window pushes cumulative over the cap
            await expect(dm.distributeDividend("AAPL", e18(1))).to.be.revertedWithCustomError(
                dm,
                "DividendWindowCapExceeded",
            );
        });

        it("disables the cap entirely when maxDividendPerWindow == 0", async () => {
            const { dm } = await loadFixture(deploy);
            await dm.setDividendLimits(1 * 24 * 3600, 0);
            // repeated max distributions are allowed because the window check is skipped
            await dm.distributeDividend("AAPL", e18(1000));
            await dm.distributeDividend("AAPL", e18(1000));
            expect(await dm.getDividendIndex("AAPL")).to.equal(e18(2000));
            // window accounting stays at zero when the cap is disabled
            const [, cumulative] = await dm.getDividendWindow("AAPL");
            expect(cumulative).to.equal(0n);
        });

        it("resets the cumulative window once the duration has elapsed", async () => {
            const { dm } = await loadFixture(deploy);
            await dm.setDividendLimits(3600, e18(2));
            await dm.distributeDividend("AAPL", e18(2)); // fills the window to the cap
            // jump past the window so the next distribution starts a fresh window
            await time.increase(3601);
            await dm.distributeDividend("AAPL", e18(2)); // would exceed cap if not reset
            const [, cumulative] = await dm.getDividendWindow("AAPL");
            expect(cumulative).to.equal(e18(2));
            expect(await dm.getDividendIndex("AAPL")).to.equal(e18(4));
        });

        it("accumulates within the same window below the cap", async () => {
            const { dm } = await loadFixture(deploy);
            await dm.setDividendLimits(1 * 24 * 3600, e18(10));
            await dm.distributeDividend("AAPL", e18(3));
            await dm.distributeDividend("AAPL", e18(4));
            const [, cumulative] = await dm.getDividendWindow("AAPL");
            expect(cumulative).to.equal(e18(7));
        });
    });

    describe("guards", () => {
        it("reverts UpgradeTimelockActive for the zero-impl no-op", async () => {
            const { dm } = await loadFixture(deploy);
            // Nothing staged: _pendingImpl == address(0) == newImplementation, so the
            // mismatch check passes and the upgrade timelock then rejects the call.
            await expect(dm.upgradeToAndCall(ethers.ZeroAddress, "0x")).to.be.revertedWithCustomError(
                dm,
                "UpgradeTimelockActive",
            );
        });

        it("cannot be re-initialized", async () => {
            const { dm, admin } = await loadFixture(deploy);
            await expect(dm.initialize(admin.address)).to.be.reverted;
        });
    });
});
