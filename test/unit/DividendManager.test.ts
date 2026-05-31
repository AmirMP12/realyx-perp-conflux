import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { MANAGER_ROLE, TRADING_CORE_ROLE } from "../helpers/constants";

async function deploy() {
    const [admin, manager, core, other] = await ethers.getSigners();
    const DividendManager = await ethers.getContractFactory("DividendManager");
    const dm = await upgrades.deployProxy(DividendManager, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await dm.waitForDeployment();
    return { dm, admin, manager, core, other };
}

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

describe("DividendManager", () => {
    describe("distributeDividend", () => {
        it("reverts above MAX_DIVIDEND_PER_SHARE", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.distributeDividend("AAPL", e18(1001))).to.be.revertedWithCustomError(
                dm,
                "DividendTooLarge",
            );
        });
        it("reverts below MIN_DIVIDEND_PER_SHARE", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.distributeDividend("AAPL", 1n)).to.be.revertedWithCustomError(dm, "DividendTooSmall");
        });
        it("accumulates the index and emits", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.distributeDividend("AAPL", e18(1))).to.emit(dm, "DividendDistributed");
            expect(await dm.getDividendIndex("AAPL")).to.equal(e18(1));
            await dm.distributeDividend("AAPL", e18(2));
            expect(await dm.getDividendIndex("AAPL")).to.equal(e18(3));
        });
        it("only manager can distribute", async () => {
            const { dm, other } = await loadFixture(deploy);
            await expect(dm.connect(other).distributeDividend("AAPL", e18(1))).to.be.reverted;
        });
    });

    describe("setTradingCore", () => {
        it("reverts on zero address", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.setTradingCore(ethers.ZeroAddress)).to.be.revertedWithCustomError(dm, "ZeroAddress");
        });
        it("grants TRADING_CORE_ROLE and revokes the old core", async () => {
            const { dm, core, other } = await loadFixture(deploy);
            await dm.setTradingCore(core.address);
            expect(await dm.hasRole(TRADING_CORE_ROLE, core.address)).to.equal(true);
            await dm.setTradingCore(other.address);
            expect(await dm.hasRole(TRADING_CORE_ROLE, core.address)).to.equal(false);
            expect(await dm.hasRole(TRADING_CORE_ROLE, other.address)).to.equal(true);
        });
    });

    describe("settleDividends", () => {
        it("only TradingCore role", async () => {
            const { dm, other } = await loadFixture(deploy);
            await expect(
                dm.connect(other).settleDividends(1, "AAPL", e18(1000), true, 0),
            ).to.be.reverted;
        });
        it("reverts when lastIndex > currentIndex", async () => {
            const { dm, core } = await loadFixture(deploy);
            await dm.setTradingCore(core.address);
            await expect(
                dm.connect(core).settleDividends(1, "AAPL", e18(1000), true, e18(5)),
            ).to.be.revertedWithCustomError(dm, "IndexDeltaTooLarge");
        });
        it("returns zero delta when index unchanged", async () => {
            const { dm, core } = await loadFixture(deploy);
            await dm.setTradingCore(core.address);
            const [amt, idx] = await dm.connect(core).settleDividends.staticCall(1, "AAPL", e18(1000), true, 0);
            expect(amt).to.equal(0n);
            expect(idx).to.equal(0n);
        });
        it("long receives positive dividend, short pays (negative)", async () => {
            const { dm, core } = await loadFixture(deploy);
            await dm.setTradingCore(core.address);
            await dm.distributeDividend("AAPL", e18(1)); // index now 1e18
            const positionSize = e18(1000);
            const [amtLong] = await dm.connect(core).settleDividends.staticCall(1, "AAPL", positionSize, true, 0);
            const [amtShort] = await dm.connect(core).settleDividends.staticCall(1, "AAPL", positionSize, false, 0);
            // value = size * delta / 1e18 = 1000
            expect(amtLong).to.equal(e18(1000));
            expect(amtShort).to.equal(-e18(1000));
        });
    });

    describe("getUnsettledDividends (view)", () => {
        it("returns 0 when index unchanged", async () => {
            const { dm } = await loadFixture(deploy);
            expect(await dm.getUnsettledDividends("AAPL", e18(1000), true, 0)).to.equal(0n);
        });
        it("computes pending dividend cashflow", async () => {
            const { dm } = await loadFixture(deploy);
            await dm.distributeDividend("AAPL", e18(1));
            expect(await dm.getUnsettledDividends("AAPL", e18(1000), true, 0)).to.equal(e18(1000));
            expect(await dm.getUnsettledDividends("AAPL", e18(1000), false, 0)).to.equal(-e18(1000));
        });
    });

    describe("upgrade timelock", () => {
        it("propose / cancel implementation", async () => {
            const { dm } = await loadFixture(deploy);
            const dummy = "0x00000000000000000000000000000000DeaDBeef";
            await expect(dm.proposeImplementation(dummy)).to.emit(dm, "ImplementationProposed");
            await expect(dm.cancelPendingImplementation()).to.emit(dm, "ImplementationCancelled");
        });
        it("reverts proposeImplementation zero address", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.proposeImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                dm,
                "ZeroAddress",
            );
        });
    });
});
