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
});
