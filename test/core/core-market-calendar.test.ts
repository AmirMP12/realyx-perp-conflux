import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("MarketCalendar", function () {
    let marketCalendar: any;
    let admin: any;
    let operator: any;
    const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));

    beforeEach(async () => {
        [admin, operator] = await ethers.getSigners();
        const MarketCalendarFactory = await ethers.getContractFactory("MarketCalendar");
        marketCalendar = await upgrades.deployProxy(MarketCalendarFactory, [admin.address], { kind: "uups" });
        
        await marketCalendar.grantRole(MANAGER_ROLE, operator.address);
    });

    it("should allow manager to set a trading day schedule", async function () {
        // setTradingDay(marketId:string, dayOfWeek:uint8, isOpen:bool)
        await marketCalendar.connect(operator).setTradingDay("AAPL", 1, true); 

        const day = await marketCalendar.tradingDays("AAPL", 1);
        expect(day).to.be.true;
    });

    it("should allow manager to set and query holidays", async function () {
        // setHoliday(marketId:string, dateYYYYMMDD:uint256, isHoliday:bool)
        await marketCalendar.connect(operator).setHoliday("AAPL", 20251225, true);
        const isHoliday = await marketCalendar.holidays("AAPL", 20251225);
        expect(isHoliday).to.be.true;
    });

    it("should revert if non-manager tries to set trading day", async function () {
        const alice = (await ethers.getSigners())[5];
        await expect(
            marketCalendar.connect(alice).setTradingDay("AAPL", 1, true)
        ).to.be.revertedWithCustomError(marketCalendar, "AccessControlUnauthorizedAccount");
    });

    it("covers config validation and open/closed/holiday paths", async function () {
        await expect(marketCalendar.connect(operator).setTradingDay("AAPL", 7, true)).to.be.revertedWithCustomError(
            marketCalendar,
            "InvalidDay"
        );
        await expect(
            marketCalendar.connect(operator).setMarketConfig("BAD", 1500, 100, 0, false)
        ).to.be.revertedWithCustomError(marketCalendar, "InvalidTime");
        await expect(
            marketCalendar.connect(operator).setMarketConfig("BAD2", 600, 600, 0, false)
        ).to.be.revertedWithCustomError(marketCalendar, "OpenMustBeBeforeClose");

        await marketCalendar.connect(operator).setMarketConfig("EQ", 540, 1020, 0, false);
        await marketCalendar.connect(operator).setHoliday("EQ", 20240101, true);

        // Unknown market defaults to open
        expect(await marketCalendar["isMarketOpen(string)"]("UNKNOWN")).to.equal(true);
        // 24x7 path
        await marketCalendar.connect(operator).setMarketConfig("CRYPTO", 0, 1, 0, true);
        expect(await marketCalendar["isMarketOpen(string)"]("CRYPTO")).to.equal(true);
    });

    it("covers next-open-time branches", async function () {
        await marketCalendar.connect(operator).setMarketConfig("EQ2", 540, 1020, 0, false);
        await marketCalendar.connect(operator).setTradingDay("EQ2", 0, false);

        const ts = 1704067200; // 2024-01-01 00:00:00 UTC
        const next = await marketCalendar.getNextOpenTime("EQ2", ts);
        expect(next).to.be.gte(ts);

        // non-existing/24x7 immediate return paths
        expect(await marketCalendar.getNextOpenTime("UNKNOWN2", ts)).to.equal(ts);
        await marketCalendar.connect(operator).setMarketConfig("ALWAYS", 0, 1, 0, true);
        expect(await marketCalendar.getNextOpenTime("ALWAYS", ts)).to.equal(ts);
    });
});
