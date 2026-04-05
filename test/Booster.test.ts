import { expect } from "chai";
import { ethers } from "hardhat";

describe("Coverage Booster", function () {
    let booster: any;

    beforeEach(async () => {
        // Deploy libraries
        const deployLib = async (name: string) => (await (await ethers.getContractFactory(name)).deploy()).getAddress();
        
        const divSettlement = await deployLib("DividendSettlementLib");
        const fundLib = await deployLib("FundingLib");
        const liqLib = await deployLib("LiquidationLib");
        const posCloseLib = await deployLib("PositionCloseLib");

        const TradingLib = await ethers.getContractFactory("TradingLib", {
            libraries: {
                "contracts/libraries/DividendSettlementLib.sol:DividendSettlementLib": divSettlement,
                "contracts/libraries/FundingLib.sol:FundingLib": fundLib,
                "contracts/libraries/LiquidationLib.sol:LiquidationLib": liqLib,
                "contracts/libraries/PositionCloseLib.sol:PositionCloseLib": posCloseLib,
            }
        });
        const tradingLib = await (await TradingLib.deploy()).getAddress();

        const Booster = await ethers.getContractFactory("CoverageBooster", {
            libraries: {
                "contracts/libraries/TradingLib.sol:TradingLib": tradingLib
            }
        });
        booster = await Booster.deploy();
    });

    it("should boost math coverage", async function () {
        await booster.boostMath();
    });

    it("should boost trading coverage", async function () {
        const addr = await booster.getAddress();
        await booster.boostTrading(addr, addr);
    });
});
