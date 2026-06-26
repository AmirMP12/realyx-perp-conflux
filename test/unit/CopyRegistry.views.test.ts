import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

async function deploy() {
    const [owner, lead, lead2, copier, copier2] = await ethers.getSigners();
    const CopyRegistry = await ethers.getContractFactory("CopyRegistry");
    const cr = await upgrades.deployProxy(CopyRegistry, [owner.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await cr.waitForDeployment();
    return { cr, owner, lead, lead2, copier, copier2 };
}

const usdc = (n: number) => ethers.parseUnits(n.toString(), 6);

describe("CopyRegistry — views & admin", () => {
    describe("views by id", () => {
        it("getLeadTraderInfoById returns info for a registered lead", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            const info = await cr.getLeadTraderInfoById(1);
            expect(info.trader).to.equal(lead.address);
            expect(info.profitFeeBps).to.equal(1000n);
        });
        it("getCopiersOfLeadTraderById returns copiers", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            const copiers = await cr.getCopiersOfLeadTraderById(1);
            expect(copiers).to.deep.equal([copier.address]);
        });
        it("getCopiersOfLeadTraderById reverts for an unknown id", async () => {
            const { cr } = await loadFixture(deploy);
            await expect(cr.getCopiersOfLeadTraderById(999)).to.be.revertedWithCustomError(cr, "NotRegistered");
        });
        it("getCopiersOfLeadTrader reverts for unregistered address", async () => {
            const { cr, copier } = await loadFixture(deploy);
            await expect(cr.getCopiersOfLeadTrader(copier.address)).to.be.revertedWithCustomError(
                cr,
                "NotRegistered",
            );
        });
    });

    describe("deregisterChunk", () => {
        it("reverts when caller is not a registered lead", async () => {
            const { cr, copier } = await loadFixture(deploy);
            await expect(cr.connect(copier).deregisterChunk(10)).to.be.revertedWithCustomError(cr, "NotRegistered");
        });

        it("drains copiers in chunks; record persists until fully drained", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            // create 3 copiers via fresh wallets funded for gas
            const wallets = [];
            for (let i = 0; i < 3; i++) {
                const w = ethers.Wallet.createRandom().connect(ethers.provider);
                await (await ethers.getSigners())[0].sendTransaction({ to: w.address, value: ethers.parseEther("1") });
                await cr.connect(w).followTrader(lead.address, usdc(1000), 5);
                wallets.push(w);
            }
            const info = await cr.getLeadTraderInfo(lead.address);
            expect(info.activeFollowers).to.equal(3n);
            // drain only 2 -> record still present, draining latched
            await cr.connect(lead).deregisterChunk(2);
            const infoMid = await cr.getLeadTraderInfo(lead.address);
            expect(infoMid.activeFollowers).to.equal(1n);
            // new follow is blocked while draining
            const w2 = ethers.Wallet.createRandom().connect(ethers.provider);
            await (await ethers.getSigners())[0].sendTransaction({ to: w2.address, value: ethers.parseEther("1") });
            await expect(cr.connect(w2).followTrader(lead.address, usdc(1000), 5)).to.be.revertedWithCustomError(
                cr,
                "NotRegistered",
            );
            // drain the rest -> record deleted
            await cr.connect(lead).deregisterChunk(10);
            await expect(cr.getLeadTraderInfo(lead.address)).to.be.revertedWithCustomError(cr, "NotRegistered");
        });

        it("deregisterAsLeadTrader reverts when not registered", async () => {
            const { cr, copier } = await loadFixture(deploy);
            await expect(cr.connect(copier).deregisterAsLeadTrader()).to.be.revertedWithCustomError(
                cr,
                "NotRegistered",
            );
        });
    });

    describe("UUPS upgrade timelock", () => {
        it("proposeImplementation rejects zero and stages otherwise", async () => {
            const { cr, owner } = await loadFixture(deploy);
            await expect(cr.connect(owner).proposeImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                cr,
                "ZeroAddress",
            );
            await expect(cr.connect(owner).proposeImplementation(owner.address)).to.emit(cr, "ImplementationProposed");
            const [pending, effective] = await cr.pendingImplementation();
            expect(pending).to.equal(owner.address);
            expect(effective).to.be.greaterThan(0n);
        });
        it("cancelPendingImplementation clears the staged upgrade", async () => {
            const { cr, owner } = await loadFixture(deploy);
            await cr.connect(owner).proposeImplementation(owner.address);
            await expect(cr.connect(owner).cancelPendingImplementation()).to.emit(cr, "ImplementationCancelled");
            const [pending, effective] = await cr.pendingImplementation();
            expect(pending).to.equal(ethers.ZeroAddress);
            expect(effective).to.equal(0n);
        });
        it("only owner can propose", async () => {
            const { cr, copier } = await loadFixture(deploy);
            await expect(cr.connect(copier).proposeImplementation(copier.address)).to.be.reverted;
        });
    });
});

describe("CopyRegistry — UUPS upgrade execution", () => {
    async function deployForUpgrade() {
        const [owner] = await ethers.getSigners();
        const CopyRegistry = await ethers.getContractFactory("CopyRegistry");
        const cr = await upgrades.deployProxy(CopyRegistry, [owner.address], {
            kind: "uups",
            initializer: "initialize",
        });
        await cr.waitForDeployment();
        return { cr, owner, CopyRegistry };
    }

    it("reverts upgrade when no proposal staged (mismatch)", async () => {
        const { cr, CopyRegistry } = await loadFixture(deployForUpgrade);
        const newImpl = await CopyRegistry.deploy();
        await newImpl.waitForDeployment();
        await expect(
            cr.upgradeToAndCall(await newImpl.getAddress(), "0x"),
        ).to.be.revertedWithCustomError(cr, "PendingImplementationMismatch");
    });

    it("reverts upgrade while timelock active, succeeds after it elapses", async () => {
        const { cr, CopyRegistry } = await loadFixture(deployForUpgrade);
        const newImpl = await CopyRegistry.deploy();
        await newImpl.waitForDeployment();
        const addr = await newImpl.getAddress();
        await cr.proposeImplementation(addr);
        await expect(cr.upgradeToAndCall(addr, "0x")).to.be.revertedWithCustomError(cr, "UpgradeTimelockActive");
        await time.increase(48 * 60 * 60 + 1);
        await cr.upgradeToAndCall(addr, "0x");
        // pending cleared after a successful upgrade
        const [pending] = await cr.pendingImplementation();
        expect(pending).to.equal(ethers.ZeroAddress);
    });
});

describe("CopyRegistry — follow / unfollow & copier config", () => {
    async function deployC() {
        const [owner, lead, lead2, copier, copier2, copier3] = await ethers.getSigners();
        const CopyRegistry = await ethers.getContractFactory("CopyRegistry");
        const cr = await upgrades.deployProxy(CopyRegistry, [owner.address], {
            kind: "uups",
            initializer: "initialize",
        });
        await cr.waitForDeployment();
        return { cr, owner, lead, lead2, copier, copier2, copier3 };
    }

    it("unfollowTrader removes a non-tail copier from the middle of the list", async () => {
        const { cr, lead, copier, copier2, copier3 } = await loadFixture(deployC);
        await cr.connect(lead).registerAsLeadTrader(1000, "x");
        await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
        await cr.connect(copier2).followTrader(lead.address, usdc(1000), 5);
        await cr.connect(copier3).followTrader(lead.address, usdc(1000), 5);
        // remove the first copier (forces the swap-with-tail path mid-array)
        await cr.connect(copier).unfollowTrader(lead.address);
        const copiers = await cr.getCopiersOfLeadTrader(lead.address);
        expect(copiers.length).to.equal(2);
        expect(copiers).to.not.include(copier.address);
    });

    it("updateCopierConfig rejects maxLeverage above 100", async () => {
        const { cr, lead, copier } = await loadFixture(deployC);
        await cr.connect(lead).registerAsLeadTrader(1000, "x");
        await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
        await expect(
            cr.connect(copier).updateCopierConfig(lead.address, usdc(2000), 101),
        ).to.be.revertedWithCustomError(cr, "InvalidMaxLeverage");
        await expect(
            cr.connect(copier).updateCopierConfig(lead.address, usdc(2000), 0),
        ).to.be.revertedWithCustomError(cr, "InvalidMaxLeverage");
    });

    it("getCopierFollowing skips deregistered leads", async () => {
        const { cr, lead, lead2, copier } = await loadFixture(deployC);
        await cr.connect(lead).registerAsLeadTrader(1000, "x");
        await cr.connect(lead2).registerAsLeadTrader(500, "y");
        await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
        await cr.connect(copier).followTrader(lead2.address, usdc(1000), 5);
        // deregister lead (single copier path drains fully and deletes the record)
        await cr.connect(lead).deregisterAsLeadTrader();
        const follows = await cr.getCopierFollowing(copier.address);
        // lead's record deleted -> enumeration only returns lead2
        expect(follows).to.include(lead2.address);
    });

    it("followTrader rejects an invalid max leverage of 0 and >100", async () => {
        const { cr, lead, copier } = await loadFixture(deployC);
        await cr.connect(lead).registerAsLeadTrader(1000, "x");
        await expect(cr.connect(copier).followTrader(lead.address, usdc(1000), 0)).to.be.revertedWithCustomError(
            cr,
            "InvalidMaxLeverage",
        );
        await expect(
            cr.connect(copier).followTrader(lead.address, usdc(1000), 101),
        ).to.be.revertedWithCustomError(cr, "InvalidMaxLeverage");
    });
});
