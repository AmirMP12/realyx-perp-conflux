import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { upgrades } from "hardhat";

async function deployCalendar() {
    const [admin, manager, other] = await ethers.getSigners();
    const MarketCalendar = await ethers.getContractFactory("MarketCalendar");
    const cal = await upgrades.deployProxy(MarketCalendar, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await cal.waitForDeployment();
    return { cal, admin, manager, other };
}

describe("MarketCalendar", () => {
    describe("setMarketConfig", () => {
        it("reverts on invalid open/close minute (>= 1440)", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await expect(cal.setMarketConfig("X", 1440, 1000, 0, false)).to.be.revertedWithCustomError(
                cal,
                "InvalidTime",
            );
        });
        it("reverts when open >= close for non-24x7", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await expect(cal.setMarketConfig("X", 600, 600, 0, false)).to.be.revertedWithCustomError(
                cal,
                "OpenMustBeBeforeClose",
            );
        });
        it("reverts on out-of-range timezone offset", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await expect(cal.setMarketConfig("X", 60, 600, -800, false)).to.be.revertedWithCustomError(
                cal,
                "InvalidTime",
            );
            await expect(cal.setMarketConfig("X", 60, 600, 900, false)).to.be.revertedWithCustomError(
                cal,
                "InvalidTime",
            );
        });
        it("configures weekday trading days for non-24x7", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await expect(cal.setMarketConfig("NYSE", 570, 960, -300, false)).to.emit(cal, "MarketHoursSet");
            expect(await cal.tradingDays("NYSE", 1)).to.equal(true); // Monday
            expect(await cal.tradingDays("NYSE", 0)).to.equal(false); // Sunday
            expect(await cal.tradingDays("NYSE", 6)).to.equal(false); // Saturday
        });
        it("24x7 markets are always open", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("CRYPTO", 0, 1439, 0, true);
            expect(await cal["isMarketOpen(string)"]("CRYPTO")).to.equal(true);
            for (let d = 0; d <= 6; d++) expect(await cal.tradingDays("CRYPTO", d)).to.equal(true);
        });
        it("only manager can configure", async () => {
            const { cal, other } = await loadFixture(deployCalendar);
            await expect(cal.connect(other).setMarketConfig("X", 60, 600, 0, false)).to.be.reverted;
        });
    });

    describe("isMarketOpen", () => {
        it("unconfigured markets default closed", async () => {
            const { cal } = await loadFixture(deployCalendar);
            expect(await cal["isMarketOpen(string)"]("UNKNOWN")).to.equal(false);
        });
        it("respects holidays", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 0, 1439, 0, false); // open all day on weekdays
            // pick a known weekday timestamp: 2025-06-02 (Monday) 12:00 UTC
            const monday = Math.floor(Date.parse("2025-06-02T12:00:00Z") / 1000);
            expect(await cal["isMarketOpen(string,uint256)"]("EQ", monday)).to.equal(true);
            await cal.setHoliday("EQ", 20250602, true);
            expect(await cal["isMarketOpen(string,uint256)"]("EQ", monday)).to.equal(false);
        });
        it("closed on weekends for non-24x7", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 0, 1439, 0, false);
            const sunday = Math.floor(Date.parse("2025-06-01T12:00:00Z") / 1000); // Sunday
            expect(await cal["isMarketOpen(string,uint256)"]("EQ", sunday)).to.equal(false);
        });
        it("respects open/close minute window", async () => {
            const { cal } = await loadFixture(deployCalendar);
            // open 09:30 (570) to 16:00 (960) UTC
            await cal.setMarketConfig("EQ", 570, 960, 0, false);
            const monOpen = Math.floor(Date.parse("2025-06-02T10:00:00Z") / 1000);
            const monClosed = Math.floor(Date.parse("2025-06-02T17:00:00Z") / 1000);
            expect(await cal["isMarketOpen(string,uint256)"]("EQ", monOpen)).to.equal(true);
            expect(await cal["isMarketOpen(string,uint256)"]("EQ", monClosed)).to.equal(false);
        });
        it("reverts on timestamps beyond MAX_VALID_TIMESTAMP", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 0, 1439, 0, false);
            await expect(
                cal["isMarketOpen(string,uint256)"]("EQ", 2_000_000_000_001n),
            ).to.be.revertedWithCustomError(cal, "TimestampOutOfRange");
        });
    });

    describe("setTradingDay", () => {
        it("reverts on invalid day", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 0, 1439, 0, false);
            await expect(cal.setTradingDay("EQ", 7, true)).to.be.revertedWithCustomError(cal, "InvalidDay");
        });
        it("reverts when closing all days for non-24x7", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 0, 1439, 0, false);
            // close every weekday one at a time; the last close should revert
            await cal.setTradingDay("EQ", 1, false);
            await cal.setTradingDay("EQ", 2, false);
            await cal.setTradingDay("EQ", 3, false);
            await cal.setTradingDay("EQ", 4, false);
            await expect(cal.setTradingDay("EQ", 5, false)).to.be.revertedWithCustomError(cal, "AllDaysClosed");
        });
    });

    describe("getNextOpenTime", () => {
        it("returns fromTimestamp for 24x7", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("CRYPTO", 0, 1439, 0, true);
            const now = await time.latest();
            expect(await cal.getNextOpenTime("CRYPTO", now)).to.equal(now);
        });
        it("returns fromTimestamp for unconfigured market", async () => {
            const { cal } = await loadFixture(deployCalendar);
            const now = await time.latest();
            expect(await cal.getNextOpenTime("UNK", now)).to.equal(now);
        });
        it("advances to next open window when currently closed", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 570, 960, 0, false);
            const sunday = Math.floor(Date.parse("2025-06-01T12:00:00Z") / 1000);
            const next = await cal.getNextOpenTime("EQ", sunday);
            expect(next).to.be.greaterThan(BigInt(sunday));
        });
        it("returns same time when already inside the window", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await cal.setMarketConfig("EQ", 0, 1439, 0, false);
            const mon = Math.floor(Date.parse("2025-06-02T12:00:00Z") / 1000);
            expect(await cal.getNextOpenTime("EQ", mon)).to.equal(BigInt(mon));
        });
    });

    describe("upgrade timelock", () => {
        it("reverts proposeImplementation with zero address", async () => {
            const { cal } = await loadFixture(deployCalendar);
            await expect(cal.proposeImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                cal,
                "ZeroAddress",
            );
        });
        it("stages and cancels an implementation", async () => {
            const { cal } = await loadFixture(deployCalendar);
            const dummy = "0x00000000000000000000000000000000DeaDBeef";
            await expect(cal.proposeImplementation(dummy)).to.emit(cal, "ImplementationProposed");
            const [pending] = await cal.pendingImplementation();
            expect(pending).to.equal(ethers.getAddress(dummy));
            await expect(cal.cancelPendingImplementation()).to.emit(cal, "ImplementationCancelled");
            const [after] = await cal.pendingImplementation();
            expect(after).to.equal(ethers.ZeroAddress);
        });
    });
});
