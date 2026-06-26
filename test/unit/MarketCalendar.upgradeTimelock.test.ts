import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

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

const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("MarketCalendar", () => {
    describe("UUPS upgrade timelock", () => {
        it("proposeImplementation reverts on the zero address", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await expect(cal.proposeImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                cal,
                "ZeroAddress",
            );
        });

        it("upgradeToAndCall reverts PendingImplementationMismatch when nothing is staged", async () => {
            const { cal, MarketCalendar } = await loadFixture(deployCalendar);
            const newImpl = await MarketCalendar.deploy();
            await newImpl.waitForDeployment();
            await expect(
                cal.upgradeToAndCall(await newImpl.getAddress(), "0x"),
            ).to.be.revertedWithCustomError(cal, "PendingImplementationMismatch");
        });

        it("upgrade reverts while the timelock is active, then succeeds after it elapses", async () => {
            const { cal, MarketCalendar } = await loadFixture(deployCalendar);
            const newImpl = await MarketCalendar.deploy();
            await newImpl.waitForDeployment();
            const addr = await newImpl.getAddress();
            await expect(cal.proposeImplementation(addr)).to.emit(cal, "ImplementationProposed");
            await expect(cal.upgradeToAndCall(addr, "0x")).to.be.revertedWithCustomError(
                cal,
                "UpgradeTimelockActive",
            );
            await time.increase(48 * 60 * 60 + 1);
            await cal.upgradeToAndCall(addr, "0x");
            const [pending, effective] = await cal.pendingImplementation();
            expect(pending).to.equal(ethers.ZeroAddress);
            expect(effective).to.equal(0n);
        });

        it("cancelPendingImplementation clears a staged upgrade", async () => {
            const { cal, MarketCalendar } = await loadFixture(deployCalendar);
            const newImpl = await MarketCalendar.deploy();
            await newImpl.waitForDeployment();
            await cal.proposeImplementation(await newImpl.getAddress());
            await expect(cal.cancelPendingImplementation()).to.emit(cal, "ImplementationCancelled");
            const [pending, effective] = await cal.pendingImplementation();
            expect(pending).to.equal(ethers.ZeroAddress);
            expect(effective).to.equal(0n);
        });

        it("non-admin cannot upgrade (authorize role guard)", async () => {
            const { cal, stranger, MarketCalendar } = await loadFixture(deployCalendar);
            const newImpl = await MarketCalendar.deploy();
            await newImpl.waitForDeployment();
            await expect(cal.connect(stranger).upgradeToAndCall(await newImpl.getAddress(), "0x")).to.be.reverted;
        });
    });

    describe("config validation", () => {
        it("setMarketConfig reverts InvalidTime when closeTime >= 1440", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await expect(cal.setMarketConfig("EQ", 100, 1440, 0, false)).to.be.revertedWithCustomError(
                cal,
                "InvalidTime",
            );
        });

        it("setTradingDay reverts InvalidDay for a day index above 6", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 570, 960, 0, false);
            await expect(cal.setTradingDay("EQ", 7, true)).to.be.revertedWithCustomError(cal, "InvalidDay");
        });

        it("setTradingDay on a 24x7 market skips the all-days-closed guard", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("CX", 0, 1439, 0, true); // is24x7
            // a 24x7 market skips the all-days-closed guard, so closing a day must not revert
            await cal.setTradingDay("CX", 3, false);
            expect(await cal.tradingDays("CX", 3)).to.equal(false);
        });

        it("setHoliday with isHoliday=false emits HolidayRemoved", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await expect(cal.setHoliday("EQ", 20250704, false)).to.emit(cal, "HolidayRemoved");
            expect(await cal.holidays("EQ", 20250704)).to.equal(false);
        });
    });

    describe("time-adjustment edge cases", () => {
        it("isMarketOpen returns false when the timezone-adjusted time is negative", async () => {
            const { cal } = await loadFixture(deployCalendar);
            // -12h offset; a tiny timestamp drives adjustedTime below zero
            await cal.setMarketConfig("FX", 0, 1439, -720, false);
            expect(await cal["isMarketOpen(string,uint256)"]("FX", 100n)).to.equal(false);
        });

        it("getNextOpenTime returns fromTimestamp when the adjusted time is negative", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("FX", 570, 960, -720, false);
            expect(await cal.getNextOpenTime("FX", 100n)).to.equal(100n);
        });

        it("isMarketOpen evaluates a January date", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 0, 1439, 0, false);
            // 2025-01-15 is a Wednesday at noon UTC -> open, exercising the Jan/Feb date path
            expect(await cal["isMarketOpen(string,uint256)"]("EQ", ts("2025-01-15T12:00:00Z"))).to.equal(true);
        });
    });
});
