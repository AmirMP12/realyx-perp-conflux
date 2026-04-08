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

    it("covers trading-core role, zero-address, large dividend and settle branches", async function () {
        const [_, __, tradingCore] = await ethers.getSigners();
        const marketId = "AAPL";

        await expect(dividendManager.setTradingCore(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            dividendManager,
            "ZeroAddress"
        );
        await dividendManager.setTradingCore(tradingCore.address);
        await dividendManager.setTradingCore(operator.address);

        await expect(
            dividendManager.connect(operator).distributeDividend(marketId, ethers.parseUnits("1001", 18))
        ).to.be.revertedWithCustomError(dividendManager, "DividendTooLarge");

        await dividendManager.connect(operator).distributeDividend(marketId, ethers.parseUnits("2", 18));

        await expect(
            dividendManager.connect(admin).settleDividends(1n, marketId, 1_000_000n, true, 0n)
        ).to.be.revertedWithCustomError(dividendManager, "AccessControlUnauthorizedAccount");

        const [amtLong] = await dividendManager
            .connect(operator)
            .settleDividends.staticCall(1n, marketId, 1_000_000n, true, 0n);
        expect(amtLong).to.be.gt(0n);

        const [amtShort] = await dividendManager
            .connect(operator)
            .settleDividends.staticCall(2n, marketId, 1_000_000n, false, 0n);
        expect(amtShort).to.be.lt(0n);

        const [amtZero] = await dividendManager
            .connect(operator)
            .settleDividends.staticCall(3n, marketId, 1_000_000n, true, await dividendManager.getDividendIndex(marketId));
        expect(amtZero).to.equal(0n);
    });

    it("covers getUnsettledDividends branches", async function () {
        const marketId = "TSLA";
        await dividendManager.connect(operator).distributeDividend(marketId, ethers.parseUnits("1", 18));

        expect(await dividendManager.getUnsettledDividends(marketId, 0n, true, 0n)).to.equal(0n);
        expect(
            await dividendManager.getUnsettledDividends(
                marketId,
                1_000_000n,
                true,
                await dividendManager.getDividendIndex(marketId)
            )
        ).to.equal(0n);
        expect(await dividendManager.getUnsettledDividends(marketId, 1_000_000n, true, 0n)).to.be.gt(0n);
        expect(await dividendManager.getUnsettledDividends(marketId, 1_000_000n, false, 0n)).to.be.lt(0n);
    });

    it("covers dividend overflow guards in settle and view helpers", async function () {
        const marketId = "OVF";
        const [_, __, tradingCore2] = await ethers.getSigners();
        await dividendManager.setTradingCore(tradingCore2.address); // previous == 0 arm
        await dividendManager.setTradingCore(operator.address);
        await dividendManager.connect(operator).distributeDividend(marketId, 3n);

        // value == 0 arm (positionSize = 0) and currentIndex != lastIndex
        const [amtZeroSize] = await dividendManager
            .connect(operator)
            .settleDividends.staticCall(8n, marketId, 0n, true, 0n);
        expect(amtZeroSize).to.equal(0n);

        // settleDividends overflow check branch
        await expect(
            dividendManager.connect(operator).settleDividends(9n, marketId, (1n << 255n), true, 0n)
        ).to.be.revertedWithCustomError(dividendManager, "DividendOverflow");

        // getUnsettledDividends overflow guard returns 0
        expect(await dividendManager.getUnsettledDividends(marketId, (1n << 255n), true, 0n)).to.equal(0n);
    });
});
