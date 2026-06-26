import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function deployCalendar() {
    const [admin, stranger] = await ethers.getSigners();
    const MarketCalendar = await ethers.getContractFactory("MarketCalendar");
    const cal = await upgrades.deployProxy(MarketCalendar, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await cal.waitForDeployment();
    return { cal, admin, stranger, MarketCalendar };
}

describe("MarketCalendar", () => {
    // The initializer cannot run a second time.
    it("initialize cannot be called twice (initializer guard)", async () => {
        const { cal, admin } = await loadFixture(deployCalendar);
        await expect(cal.initialize(admin.address)).to.be.revertedWithCustomError(
            cal,
            "InvalidInitialization",
        );
    });

    // Calling upgradeToAndCall(address(0)) with nothing staged passes the
    // PendingImplementationMismatch check (0 == _pendingImpl) and is then
    // rejected by the upgrade timelock.
    it("upgradeToAndCall(address(0)) reverts UpgradeTimelockActive when nothing staged", async () => {
        const { cal } = await loadFixture(deployCalendar);
        await expect(
            cal.upgradeToAndCall(ethers.ZeroAddress, "0x"),
        ).to.be.revertedWithCustomError(cal, "UpgradeTimelockActive");
    });

    // proposeImplementation is restricted to DEFAULT_ADMIN_ROLE.
    it("non-admin cannot proposeImplementation", async () => {
        const { cal, stranger } = await loadFixture(deployCalendar);
        await expect(
            cal.connect(stranger).proposeImplementation(stranger.address),
        ).to.be.revertedWithCustomError(cal, "AccessControlUnauthorizedAccount");
    });

    // cancelPendingImplementation is restricted to DEFAULT_ADMIN_ROLE.
    it("non-admin cannot cancelPendingImplementation", async () => {
        const { cal, stranger } = await loadFixture(deployCalendar);
        await expect(
            cal.connect(stranger).cancelPendingImplementation(),
        ).to.be.revertedWithCustomError(cal, "AccessControlUnauthorizedAccount");
    });

    // setTradingDay is restricted to MANAGER_ROLE.
    it("non-manager cannot setTradingDay", async () => {
        const { cal, stranger } = await loadFixture(deployCalendar);
        await expect(
            cal.connect(stranger).setTradingDay("EQ", 1, false),
        ).to.be.revertedWithCustomError(cal, "AccessControlUnauthorizedAccount");
    });

    // setHoliday is restricted to MANAGER_ROLE.
    it("non-manager cannot setHoliday", async () => {
        const { cal, stranger } = await loadFixture(deployCalendar);
        await expect(
            cal.connect(stranger).setHoliday("EQ", 20250704, true),
        ).to.be.revertedWithCustomError(cal, "AccessControlUnauthorizedAccount");
    });

    // The AllDaysClosed revert inside getNextOpenTime is unreachable through the
    // public API: setMarketConfig always opens weekdays for non-24x7 markets, and
    // setTradingDay refuses to close the final open day (its own AllDaysClosed
    // guard). A 24x7 market returns early at the top of getNextOpenTime, so a
    // non-24x7 market can never reach that point with every day closed.
});
