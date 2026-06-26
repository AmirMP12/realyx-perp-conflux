import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function deploy() {
    const [admin, core, stranger] = await ethers.getSigners();
    const DividendManager = await ethers.getContractFactory("DividendManager");
    const dm = await upgrades.deployProxy(DividendManager, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await dm.waitForDeployment();
    await dm.setTradingCore(core.address);
    return { dm, admin, core, stranger, DividendManager };
}

describe("DividendManager", () => {
    describe("UUPS upgrade timelock", () => {
        it("proposeImplementation reverts on the zero address", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.proposeImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                dm,
                "ZeroAddress",
            );
        });

        it("upgradeToAndCall reverts PendingImplementationMismatch when nothing is staged", async () => {
            const { dm, DividendManager } = await loadFixture(deploy);
            const newImpl = await DividendManager.deploy();
            await newImpl.waitForDeployment();
            await expect(
                dm.upgradeToAndCall(await newImpl.getAddress(), "0x"),
            ).to.be.revertedWithCustomError(dm, "PendingImplementationMismatch");
        });

        it("upgrade reverts while timelock active, then succeeds after it elapses", async () => {
            const { dm, DividendManager } = await loadFixture(deploy);
            const newImpl = await DividendManager.deploy();
            await newImpl.waitForDeployment();
            const addr = await newImpl.getAddress();
            await expect(dm.proposeImplementation(addr)).to.emit(dm, "ImplementationProposed");
            await expect(dm.upgradeToAndCall(addr, "0x")).to.be.revertedWithCustomError(
                dm,
                "UpgradeTimelockActive",
            );
            await time.increase(48 * 60 * 60 + 1);
            await dm.upgradeToAndCall(addr, "0x");
            const [pending] = await dm.pendingImplementation();
            expect(pending).to.equal(ethers.ZeroAddress);
        });

        it("cancelPendingImplementation clears a staged upgrade", async () => {
            const { dm, DividendManager } = await loadFixture(deploy);
            const newImpl = await DividendManager.deploy();
            await newImpl.waitForDeployment();
            await dm.proposeImplementation(await newImpl.getAddress());
            await expect(dm.cancelPendingImplementation()).to.emit(dm, "ImplementationCancelled");
            const [pending, effective] = await dm.pendingImplementation();
            expect(pending).to.equal(ethers.ZeroAddress);
            expect(effective).to.equal(0n);
        });
    });

    describe("setTradingCore", () => {
        it("reverts on the zero address", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.setTradingCore(ethers.ZeroAddress)).to.be.revertedWithCustomError(dm, "ZeroAddress");
        });

        it("revokes the role from a previous core when reassigning", async () => {
            const { dm, core, stranger } = await loadFixture(deploy);
            const TRADING_CORE_ROLE = await dm.TRADING_CORE_ROLE();
            expect(await dm.hasRole(TRADING_CORE_ROLE, core.address)).to.equal(true);
            await dm.setTradingCore(stranger.address);
            expect(await dm.hasRole(TRADING_CORE_ROLE, core.address)).to.equal(false);
            expect(await dm.hasRole(TRADING_CORE_ROLE, stranger.address)).to.equal(true);
        });
    });

    describe("settleDividends", () => {
        it("reverts IndexDeltaTooLarge when lastIndex rolls back below currentIndex", async () => {
            const { dm, core } = await loadFixture(deploy);
            await dm.distributeDividend("AAPL", e18(1));
            // lastIndex greater than currentIndex trips the rollback guard
            await expect(
                dm.connect(core).settleDividends(1, "AAPL", e18(1), true, e18(5)),
            ).to.be.revertedWithCustomError(dm, "IndexDeltaTooLarge");
        });

        it("settles a long position and returns a positive amount", async () => {
            const { dm, core } = await loadFixture(deploy);
            await dm.distributeDividend("AAPL", e18(1));
            const [amt, idx] = await dm.connect(core).settleDividends.staticCall(1, "AAPL", e18(1000), true, 0);
            expect(amt).to.equal(e18(1000));
            expect(idx).to.equal(e18(1));
        });

        it("returns zero when currentIndex == lastIndex", async () => {
            const { dm, core } = await loadFixture(deploy);
            const [amt, idx] = await dm.connect(core).settleDividends.staticCall(1, "AAPL", e18(1000), true, 0);
            expect(amt).to.equal(0n);
            expect(idx).to.equal(0n);
        });
    });

    describe("distributeDividend bounds", () => {
        it("rejects amounts above the maximum", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.distributeDividend("AAPL", e18(1001))).to.be.revertedWithCustomError(
                dm,
                "DividendTooLarge",
            );
        });

        it("rejects amounts below the minimum per-share floor", async () => {
            const { dm } = await loadFixture(deploy);
            await expect(dm.distributeDividend("AAPL", 1n)).to.be.revertedWithCustomError(dm, "DividendTooSmall");
        });
    });

    describe("getUnsettledDividends", () => {
        it("returns 0 when currentIndex == lastIndex", async () => {
            const { dm } = await loadFixture(deploy);
            expect(await dm.getUnsettledDividends("AAPL", e18(1000), true, 0)).to.equal(0n);
        });
    });
});
