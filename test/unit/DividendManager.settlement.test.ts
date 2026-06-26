import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { TRADING_CORE_ROLE } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function deploy() {
    const [admin, core] = await ethers.getSigners();
    const DividendManager = await ethers.getContractFactory("DividendManager");
    const dm = await upgrades.deployProxy(DividendManager, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await dm.waitForDeployment();
    await dm.setTradingCore(core.address);
    return { dm, admin, core };
}

describe("DividendManager", () => {
    it("settleDividends returns zero amount when position size is zero", async () => {
        const { dm, core } = await loadFixture(deploy);
        await dm.distributeDividend("AAPL", e18(1));
        const [amt, idx] = await dm.connect(core).settleDividends.staticCall(1, "AAPL", 0, true, 0);
        expect(amt).to.equal(0n);
        expect(idx).to.equal(e18(1));
    });

    it("settleDividends reverts on a huge index delta (overflow guard)", async () => {
        const { dm, core } = await loadFixture(deploy);
        // accumulate a normal index, then settle a position whose size * delta would overflow
        await dm.distributeDividend("AAPL", e18(1));
        await expect(
            dm.connect(core).settleDividends(1, "AAPL", ethers.MaxUint256 / 2n, true, 0),
        ).to.be.revertedWithCustomError(dm, "DividendOverflow");
    });

    it("getUnsettledDividends returns 0 when size*delta would overflow", async () => {
        const { dm } = await loadFixture(deploy);
        await dm.distributeDividend("AAPL", e18(1));
        const v = await dm.getUnsettledDividends("AAPL", ethers.MaxUint256, true, 0);
        expect(v).to.equal(0n);
    });

    it("getUnsettledDividends short side returns negative", async () => {
        const { dm } = await loadFixture(deploy);
        await dm.distributeDividend("AAPL", e18(1));
        expect(await dm.getUnsettledDividends("AAPL", e18(1000), false, 0)).to.equal(-e18(1000));
    });
});

describe("DividendManager — access control", () => {
    it("non-admin cannot distribute, set trading core, propose/cancel upgrade", async () => {
        const { dm } = await loadFixture(deploy);
        const [, , stranger] = await ethers.getSigners();
        await expect(dm.connect(stranger).distributeDividend("AAPL", e18(1))).to.be.reverted;
        await expect(dm.connect(stranger).setTradingCore(stranger.address)).to.be.reverted;
        await expect(dm.connect(stranger).proposeImplementation(stranger.address)).to.be.reverted;
        await expect(dm.connect(stranger).cancelPendingImplementation()).to.be.reverted;
    });

    it("non-trading-core cannot settleDividends", async () => {
        const { dm } = await loadFixture(deploy);
        const [, , stranger] = await ethers.getSigners();
        await expect(dm.connect(stranger).settleDividends(1, "AAPL", e18(1000), true, 0)).to.be.reverted;
    });

    it("distributeDividend rejects too-large and too-small amounts", async () => {
        const { dm } = await loadFixture(deploy);
        await expect(dm.distributeDividend("AAPL", e18(1001))).to.be.revertedWithCustomError(dm, "DividendTooLarge");
        await expect(dm.distributeDividend("AAPL", 1n)).to.be.revertedWithCustomError(dm, "DividendTooSmall");
    });

    it("settleDividends reverts when lastIndex > currentIndex", async () => {
        const { dm, core } = await loadFixture(deploy);
        await expect(
            dm.connect(core).settleDividends(1, "AAPL", e18(1000), true, e18(5)),
        ).to.be.revertedWithCustomError(dm, "IndexDeltaTooLarge");
    });
});
