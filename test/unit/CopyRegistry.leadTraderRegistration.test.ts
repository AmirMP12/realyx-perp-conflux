import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const usdc = (n: number) => ethers.parseUnits(n.toString(), 6);

async function deploy() {
    const [owner, lead, lead2, copier, copier2, copier3] = await ethers.getSigners();
    const CopyRegistry = await ethers.getContractFactory("CopyRegistry");
    const cr = await upgrades.deployProxy(CopyRegistry, [owner.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await cr.waitForDeployment();
    return { cr, owner, lead, lead2, copier, copier2, copier3 };
}

// Fund a fresh wallet for gas and return a connected signer.
async function freshSigner() {
    const [funder] = await ethers.getSigners();
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await funder.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
    return w;
}

describe("CopyRegistry", () => {
    describe("registration guards", () => {
        it("registerAsLeadTrader reverts ProfitFeeTooHigh above the 2000 bps cap", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await expect(cr.connect(lead).registerAsLeadTrader(2001, "x")).to.be.revertedWithCustomError(
                cr,
                "ProfitFeeTooHigh",
            );
        });

        it("registerAsLeadTrader reverts AlreadyRegistered on a second call", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(cr.connect(lead).registerAsLeadTrader(1000, "x")).to.be.revertedWithCustomError(
                cr,
                "AlreadyRegistered",
            );
        });

        it("updateLeadTrader reverts NotRegistered for an unknown caller", async () => {
            const { cr, copier } = await loadFixture(deploy);
            await expect(cr.connect(copier).updateLeadTrader(500, "y")).to.be.revertedWithCustomError(
                cr,
                "NotRegistered",
            );
        });

        it("updateLeadTrader reverts ProfitFeeTooHigh above the cap", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(cr.connect(lead).updateLeadTrader(2001, "y")).to.be.revertedWithCustomError(
                cr,
                "ProfitFeeTooHigh",
            );
        });

        it("updateLeadTrader succeeds within bounds", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(cr.connect(lead).updateLeadTrader(500, "y")).to.emit(cr, "LeadTraderUpdated");
            const info = await cr.getLeadTraderInfo(lead.address);
            expect(info.profitFeeBps).to.equal(500n);
        });
    });

    describe("following guards", () => {
        it("followTrader reverts NotRegistered for an unknown lead", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await expect(cr.connect(copier).followTrader(lead.address, usdc(1000), 5)).to.be.revertedWithCustomError(
                cr,
                "NotRegistered",
            );
        });

        it("followTrader reverts AlreadyFollowing on a duplicate follow", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            await expect(
                cr.connect(copier).followTrader(lead.address, usdc(1000), 5),
            ).to.be.revertedWithCustomError(cr, "AlreadyFollowing");
        });

        it("unfollowTrader reverts NotFollowing when there is no active relationship", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(cr.connect(copier).unfollowTrader(lead.address)).to.be.revertedWithCustomError(
                cr,
                "NotFollowing",
            );
        });

        it("updateCopierConfig reverts NotFollowing for a non-copier", async () => {
            const { cr, lead, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await expect(
                cr.connect(copier).updateCopierConfig(lead.address, usdc(2000), 5),
            ).to.be.revertedWithCustomError(cr, "NotFollowing");
        });

        it("unfollowTrader removes the tail copier directly (last-element path)", async () => {
            const { cr, lead, copier, copier2 } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            await cr.connect(copier2).followTrader(lead.address, usdc(1000), 5);
            // remove the last copier; its index already equals len-1
            await cr.connect(copier2).unfollowTrader(lead.address);
            const copiers = await cr.getCopiersOfLeadTrader(lead.address);
            expect(copiers).to.deep.equal([copier.address]);
            const info = await cr.getLeadTraderInfo(lead.address);
            expect(info.activeFollowers).to.equal(1n);
        });
    });

    describe("deregister chunking", () => {
        it("partial drain keeps the lead record", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            const wallets = [];
            for (let i = 0; i < 3; i++) {
                const w = await freshSigner();
                await cr.connect(w).followTrader(lead.address, usdc(1000), 5);
                wallets.push(w);
            }
            // drain only one -> 2 remain, record persists
            await cr.connect(lead).deregisterChunk(1);
            const info = await cr.getLeadTraderInfo(lead.address);
            expect(info.activeFollowers).to.equal(2n);
            // finish the drain -> record deleted
            await cr.connect(lead).deregisterChunk(10);
            await expect(cr.getLeadTraderInfo(lead.address)).to.be.revertedWithCustomError(cr, "NotRegistered");
        });

        it("deregisterAsLeadTrader fully drains a small follower set in one call", async () => {
            const { cr, lead } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            const w = await freshSigner();
            await cr.connect(w).followTrader(lead.address, usdc(1000), 5);
            await cr.connect(lead).deregisterAsLeadTrader();
            await expect(cr.getLeadTraderInfo(lead.address)).to.be.revertedWithCustomError(cr, "NotRegistered");
        });
    });

    describe("getCopierFollowing enumeration", () => {
        it("skips a deregistered lead trader", async () => {
            const { cr, lead, lead2, copier } = await loadFixture(deploy);
            await cr.connect(lead).registerAsLeadTrader(1000, "x");
            await cr.connect(lead2).registerAsLeadTrader(500, "y");
            await cr.connect(copier).followTrader(lead.address, usdc(1000), 5);
            await cr.connect(copier).followTrader(lead2.address, usdc(1000), 5);
            // delete lead's record so its slot has trader == address(0)
            await cr.connect(lead).deregisterAsLeadTrader();
            const follows = await cr.getCopierFollowing(copier.address);
            expect(follows).to.deep.equal([lead2.address]);
        });
    });
});
