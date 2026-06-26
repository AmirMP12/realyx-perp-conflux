import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { TRADING_CORE_ROLE } from "../helpers/constants";

const u = (n: number) => ethers.parseUnits(n.toString(), 6);

/**
 * ReferralRegistry — upgrade and tier guards
 *
 * Verifies the upgrade and tier-management guards:
 *   - the re-initialization revert
 *   - the discountBps/rebateBps bounds on initialize, addTier, and setDefaultRates
 *   - the admin-only authorization on upgrades, removeTier, and setDefaultRates
 *   - the volume-walk stopping at the highest qualifying tier
 *   - the MAX_TIERS (16) cap on addTier
 *   - the soft normalizer rejecting over-length and invalid-character codes
 *
 * Re-entrancy reverts on registerCode/setTraderReferralCode/transferCode are not
 * exercised: none of those paths make an external call, so the nonReentrant guard
 * cannot be tripped. A zero referrer in getTraderReferralData is likewise
 * unreachable, since a bound trader always references a non-zero code owner.
 */
async function deploy() {
    const [admin, core, alice, bob, carol] = await ethers.getSigners();
    const RR = await ethers.getContractFactory("ReferralRegistry");
    const rr = await upgrades.deployProxy(RR, [admin.address, 100, 50], {
        kind: "uups",
        initializer: "initialize",
    });
    await rr.waitForDeployment();
    await rr.grantRole(TRADING_CORE_ROLE, core.address);
    return { rr, admin, core, alice, bob, carol };
}

describe("ReferralRegistry — upgrade & tier guards", () => {
    it("initialize cannot be called twice", async () => {
        const { rr, admin } = await loadFixture(deploy);
        await expect(rr.initialize(admin.address, 100, 50)).to.be.revertedWithCustomError(
            rr,
            "InvalidInitialization",
        );
    });

    it("initialize rejects a rebate above BPS even when discount is valid", async () => {
        const RR = await ethers.getContractFactory("ReferralRegistry");
        const [admin] = await ethers.getSigners();
        // discount (50) is within bounds, so the rebate bound (10001 > 10000)
        // is what triggers InvalidParam.
        await expect(
            upgrades.deployProxy(RR, [admin.address, 50, 10001], { kind: "uups", initializer: "initialize" }),
        ).to.be.revertedWithCustomError(RR, "InvalidParam");
    });

    it("a non-admin caller cannot drive an upgrade", async () => {
        const { rr, alice } = await loadFixture(deploy);
        await expect(
            rr.connect(alice).upgradeToAndCall(alice.address, "0x"),
        ).to.be.revertedWithCustomError(rr, "NotAdmin");
    });

    it("tier walk stops at the highest qualifying tier", async () => {
        const { rr, core, alice, bob } = await loadFixture(deploy);
        await rr.connect(alice).registerCode("alice1");
        await rr.connect(bob).setTraderReferralCode("alice1");
        await rr.addTier(u(1_000), 150, 75);
        await rr.addTier(u(5_000), 250, 125);
        await rr.addTier(u(20_000), 400, 200);
        // 6_000 clears the 1k and 5k thresholds but NOT the 20k threshold, so
        // the walk-forward loop stops at the 5k tier.
        await expect(rr.connect(core).recordReferralVolume(bob.address, u(6_000))).to.emit(rr, "TierUpgraded");
        const data = await rr.getTraderReferralData(bob.address);
        expect(data.discountBps).to.equal(250);
        expect(data.rebateBps).to.equal(125);
    });

    it("addTier rejects a rebate above BPS even when discount is valid", async () => {
        const { rr } = await loadFixture(deploy);
        await expect(rr.addTier(u(1_000), 50, 10001)).to.be.revertedWithCustomError(rr, "InvalidTierConfig");
    });

    it("addTier reverts once the MAX_TIERS (16) cap is reached", async () => {
        const { rr } = await loadFixture(deploy);
        for (let i = 1; i <= 16; i++) {
            await rr.addTier(u(1_000 * i), 100, 50);
        }
        expect(await rr.tierCount()).to.equal(16n);
        await expect(rr.addTier(u(1_000_000), 100, 50)).to.be.revertedWithCustomError(rr, "InvalidTierConfig");
    });

    it("a non-admin caller cannot remove a tier", async () => {
        const { rr, alice } = await loadFixture(deploy);
        await rr.addTier(u(1_000), 100, 50);
        await expect(rr.connect(alice).removeTier(u(1_000))).to.be.revertedWithCustomError(rr, "NotAdmin");
    });

    it("a non-admin caller cannot set default rates", async () => {
        const { rr, alice } = await loadFixture(deploy);
        await expect(rr.connect(alice).setDefaultRates(100, 50)).to.be.revertedWithCustomError(rr, "NotAdmin");
    });

    it("setDefaultRates rejects a rebate above BPS even when discount is valid", async () => {
        const { rr } = await loadFixture(deploy);
        await expect(rr.setDefaultRates(50, 10001)).to.be.revertedWithCustomError(rr, "InvalidParam");
    });

    it("isCodeAvailable returns false for a too-long code", async () => {
        const { rr } = await loadFixture(deploy);
        // 17 chars exceeds MAX_CODE_LENGTH, so the soft normalizer rejects it.
        expect(await rr.isCodeAvailable("a".repeat(17))).to.equal(false);
    });

    it("ownerOfCode returns zero for a code with invalid characters", async () => {
        const { rr } = await loadFixture(deploy);
        // valid length (4) but contains '!' -> the soft normalizer rejects the
        // code and reports it as unavailable.
        expect(await rr.ownerOfCode("ab!d")).to.equal(ethers.ZeroAddress);
        expect(await rr.isCodeAvailable("ab!d")).to.equal(false);
    });
});
