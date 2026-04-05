import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("DividendManager", function () {
    let dividendManager: any;
    let admin: any;
    let operator: any;
    const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));

    beforeEach(async () => {
        [admin, operator] = await ethers.getSigners();
        const DividendManagerFactory = await ethers.getContractFactory("DividendManager");
        dividendManager = await upgrades.deployProxy(DividendManagerFactory, [admin.address], { kind: "uups" });
        
        await dividendManager.grantRole(MANAGER_ROLE, operator.address);
    });

    it("should allow manager to distribute a dividend for a market", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        
        // distributeDividend(market, amountPerShare)
        await dividendManager.connect(operator).distributeDividend(dummyMarket, ethers.parseUnits("1.5", 6)); 

        const idx = await dividendManager.getDividendIndex(dummyMarket);
        expect(idx).to.be.gt(0);
    });

    it("should track dividend indices per market", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        
        const idxBefore = await dividendManager.getDividendIndex(dummyMarket);
        await dividendManager.connect(operator).distributeDividend(dummyMarket, ethers.parseUnits("2", 6));
        const idxAfter = await dividendManager.getDividendIndex(dummyMarket);

        expect(idxAfter).to.be.gt(idxBefore);
    });

    it("should revert if non-manager tries to distribute", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        const alice = (await ethers.getSigners())[5];
        
        await expect(
            dividendManager.connect(alice).distributeDividend(dummyMarket, 100)
        ).to.be.revertedWithCustomError(dividendManager, "AccessControlUnauthorizedAccount");
    });
});
