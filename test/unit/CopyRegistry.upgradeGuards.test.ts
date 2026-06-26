import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const usdc = (n: number) => ethers.parseUnits(n.toString(), 6);

/**
 * CopyRegistry — upgrade guards
 *
 * Verifies the upgrade and enumeration guards:
 *   - the re-initialization revert
 *   - the owner-only authorization on upgrades and cancelPendingImplementation
 *   - the upgrade timelock when no implementation is staged
 *   - deregisterAsLeadTrader leaving a remainder when followers exceed the drain batch
 *   - getCopierFollowing skipping live leads the copier does not follow
 *
 * The activeFollowers == 0 underflow guards in _deregisterChunk and unfollowTrader
 * are not exercised: copier counts and activeFollowers are mutated in lock-step by
 * every path (follow +1/+1, unfollow -1/-1, drain -1/-1), so whenever there is a
 * copier to drain or unfollow, activeFollowers is necessarily greater than zero.
 */
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

// A funded random wallet so we can create > 50 distinct copiers cheaply
// (balance set directly rather than via a funding transaction).
async function makeFollower() {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [w.address, "0x3635C9ADC5DEA00000"]); // 1000 ETH
    return w;
}

describe("CopyRegistry — upgrade guards", () => {
    it("initialize cannot be called twice", async () => {
        const { cr, owner } = await loadFixture(deploy);
        await expect(cr.initialize(owner.address)).to.be.revertedWithCustomError(cr, "InvalidInitialization");
    });

    it("a non-owner caller cannot drive an upgrade", async () => {
        const { cr, copier } = await loadFixture(deploy);
        await expect(
            cr.connect(copier).upgradeToAndCall(copier.address, "0x"),
        ).to.be.revertedWithCustomError(cr, "OwnableUnauthorizedAccount");
    });

    it("upgrade with nothing staged reverts UpgradeTimelockActive", async () => {
        const { cr } = await loadFixture(deploy);
        // owner caller, nothing proposed: _pendingImpl == 0, so passing
        // address(0) clears the mismatch check (0 == 0) and the upgrade
        // timelock then rejects the call.
        await expect(
            cr.upgradeToAndCall(ethers.ZeroAddress, "0x"),
        ).to.be.revertedWithCustomError(cr, "UpgradeTimelockActive");
    });

    it("a non-owner caller cannot cancel a pending implementation", async () => {
        const { cr, copier } = await loadFixture(deploy);
        await expect(cr.connect(copier).cancelPendingImplementation()).to.be.revertedWithCustomError(
            cr,
            "OwnableUnauthorizedAccount",
        );
    });

    it("deregisterAsLeadTrader leaves a remainder when followers exceed the drain batch", async () => {
        const { cr, lead } = await loadFixture(deploy);
        await cr.connect(lead).registerAsLeadTrader(1000, "x");
        // 51 followers > MAX_DEREG_BATCH (50): one deregister call drains 50 and
        // leaves 1, so the copier list is not empty and the record is NOT deleted.
        for (let i = 0; i < 51; i++) {
            const w = await makeFollower();
            await cr.connect(w).followTrader(lead.address, usdc(1000), 5);
        }
        await cr.connect(lead).deregisterAsLeadTrader();
        // record survives the partial drain
        const info = await cr.getLeadTraderInfo(lead.address);
        expect(info.activeFollowers).to.equal(1n);
        expect(await cr.addressToLeadTraderId(lead.address)).to.equal(1n);
        const copiers = await cr.getCopiersOfLeadTrader(lead.address);
        expect(copiers.length).to.equal(1);
    });

    it("getCopierFollowing skips a LIVE lead the copier does not follow", async () => {
        const { cr, lead, lead2, copier } = await loadFixture(deploy);
        await cr.connect(lead).registerAsLeadTrader(1000, "x");
        await cr.connect(lead2).registerAsLeadTrader(500, "y");
        // copier follows only lead2; lead remains registered but inactive for
        // this copier, so it is skipped in both the counting and fill passes.
        await cr.connect(copier).followTrader(lead2.address, usdc(1000), 5);
        const follows = await cr.getCopierFollowing(copier.address);
        expect(follows).to.deep.equal([lead2.address]);
    });

    it("getCopierFollowing returns empty when a copier follows none of the live leads", async () => {
        const { cr, lead, lead2, copier } = await loadFixture(deploy);
        await cr.connect(lead).registerAsLeadTrader(1000, "x");
        await cr.connect(lead2).registerAsLeadTrader(500, "y");
        // copier follows neither live lead -> both leads are skipped as
        // inactive in both passes.
        const follows = await cr.getCopierFollowing(copier.address);
        expect(follows).to.deep.equal([]);
    });

    it("enumeration handles a mix of deregistered, followed and unfollowed leads", async () => {
        const { cr, lead, lead2, copier, copier2 } = await loadFixture(deploy);
        await cr.connect(lead).registerAsLeadTrader(1000, "x"); // id 1 -> will be deregistered
        await cr.connect(lead2).registerAsLeadTrader(500, "y"); // id 2 -> followed
        await cr.connect(copier2).registerAsLeadTrader(250, "z"); // id 3 -> live but NOT followed
        await cr.connect(copier).followTrader(lead2.address, usdc(1000), 5);
        // deregister lead (a single copier-less drain deletes the record, so it is skipped)
        await cr.connect(lead).deregisterAsLeadTrader();
        const follows = await cr.getCopierFollowing(copier.address);
        // only lead2 followed; id3 is live but not followed
        expect(follows).to.deep.equal([lead2.address]);
    });
});
