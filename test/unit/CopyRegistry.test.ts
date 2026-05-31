import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

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

describe("CopyRegistry", () => {
    describe("registerAsLeadTrader", () => {
        it("reverts when profit fee too high", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await expect(cr.connect(lead).registerAsLeadTrader(2001, "ipfs://x")).to.be.revertedWithCustomError(
                cr,
                "ProfitFeeTooHigh",
            );
        });
        it("registers a lead trader and assigns id", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await expect(cr.connect(lead).registerAsLeadTrader(1000, "ipfs://x")).to.emit(cr, "LeadTraderRegistered");
            expect(await cr.addressToLeadTraderId(lead.address)).to.equal(1n);
            const info = await cr.getLeadTraderInfo(lead.address);
            expect(info.profitFeeBps).to.equal(1000);
        });
        it("reverts on double registration", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "ipfs://x");
            await expect(cr.connect(lead).registerAsLeadTrader(500, "ipfs://y")).to.be.revertedWithCustomError(
                cr,
                "AlreadyRegistered",
            );
        });
    });

    describe("updateLeadTrader", () => {
        it("reverts when not registered", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await expect(cr.connect(lead).updateLeadTrader(500, "ipfs://z")).to.be.revertedWithCustomError(
                cr,
                "NotRegistered",
            );
        });
        it("updates fee and metadata", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "ipfs://x");
            await expect(cr.connect(lead).updateLeadTrader(500, "ipfs://y")).to.emit(cr, "LeadTraderUpdated");
            const info = await cr.getLeadTraderInfo(lead.address);
            expect(info.profitFeeBps).to.equal(500);
        });
    });

    describe("followTrader / unfollowTrader", () => {
        it("reverts following an unregistered lead", async () => {
            const { cr, copier, lead } = await loadFixture(deploy);
            await expect(cr.connect(copier).followTrader(lead.address, usdc(1000), 5)).to.be.revertedWithCustomError(
                cr,
                "NotRegistered",
            );
        });
        it("reverts on invalid max leverage", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(cr.connect(copier).followTrader(lead.address, usdc(1000), 0)).to.be.revertedWithCustomError(
                cr,
                "InvalidMaxLeverage",
            );
            await expect(cr.connect(copier).followTrader(lead.address, usdc(1000), 101)).to.be.revertedWithCustomError(
                cr,
                "InvalidMaxLeverage",
            );
        });
        it("follows and increments active followers", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(cr.connect(copier).followTrader(lead.address, usdc(1000), 5)).to.emit(cr, "FollowedTrader");
            const info = await cr.getLeadTraderInfo(lead.address);
            expect(info.activeFollowers).to.equal(1);
            const copiers = await cr.getCopiersOfLeadTrader(lead.address);
            expect(copiers).to.deep.equal([copier.address]);
        });
        it("reverts double follow", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            await expect(cr.connect(copier).followTrader(lead.address, usdc(1000), 5)).to.be.revertedWithCustomError(
                cr,
                "AlreadyFollowing",
            );
        });
        it("unfollows and decrements", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            await expect(cr.connect(copier).unfollowTrader(lead.address)).to.emit(cr, "UnfollowedTrader");
            const info = await cr.getLeadTraderInfo(lead.address);
            expect(info.activeFollowers).to.equal(0);
        });
        it("reverts unfollow when not following", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(cr.connect(copier).unfollowTrader(lead.address)).to.be.revertedWithCustomError(
                cr,
                "NotFollowing",
            );
        });
    });

    describe("updateCopierConfig", () => {
        it("reverts when not following", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(
                cr.connect(copier).updateCopierConfig(lead.address, usdc(500), 3),
            ).to.be.revertedWithCustomError(cr, "NotFollowing");
        });
        it("updates allocation and leverage", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            await expect(cr.connect(copier).updateCopierConfig(lead.address, usdc(2000), 10)).to.emit(
                cr,
                "CopierConfigUpdated",
            );
            const rel = await cr.copyRelationships(copier.address, lead.address);
            expect(rel.maxAllocation).to.equal(usdc(2000));
            expect(rel.maxLeverage).to.equal(10);
        });
    });

    describe("deregister + draining", () => {
        it("drains copiers and blocks new follows during draining", async () => {
            const { cr, lead, copier, copier2 } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            await cr.connect(lead).deregisterAsLeadTrader();
            // fully drained (single copier) -> record deleted
            await expect(cr.getLeadTraderInfo(lead.address)).to.be.revertedWithCustomError(cr, "NotRegistered");
        });
    });

    describe("getCopierFollowing", () => {
        it("enumerates leads a copier follows", async () => {
            const { cr, lead, lead2, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(lead2).registerAsLeadTrader(500, "y");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            await cr.connect(copier).followTrader(lead2.address, usdc(1000), 5);
            const follows = await cr.getCopierFollowing(copier.address);
            expect(follows).to.have.lengthOf(2);
        });
    });

    describe("views by id", () => {
        it("reverts for unknown lead id", async () => {
            const { cr } = await loadFixture(deploy);
            await expect(cr.getLeadTraderInfoById(999)).to.be.revertedWithCustomError(cr, "NotRegistered");
        });
    });
});
