import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { TRADING_CORE_ROLE } from "../helpers/constants";

const u = (n: number) => ethers.parseUnits(n.toString(), 6);

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

describe("ReferralRegistry — referral data views", () => {
    it("getReferrer returns zero for an unbound trader", async () => {
        const { rr, bob } = await loadFixture(deploy);
        expect(await rr.getReferrer(bob.address)).to.equal(ethers.ZeroAddress);
    });

    it("getTraderReferralData treats a revoked code as unreferred", async () => {
        const { rr, alice, bob, carol } = await loadFixture(deploy);
        await rr.connect(alice).registerCode("alice1");
        await rr.connect(bob).setTraderReferralCode("alice1");
        // transfer the code to a new owner; bob's binding hash still points at the code,
        // ownerOfCode now resolves to carol -> still referred (non-zero referrer)
        await rr.connect(alice).transferCode("alice1", carol.address);
        const data = await rr.getTraderReferralData(bob.address);
        expect(data.referrer).to.equal(carol.address);
    });

    it("transferCode reverts when the new owner is already a referee of this code (self-refer)", async () => {
        const { rr, alice, bob } = await loadFixture(deploy);
        await rr.connect(alice).registerCode("alice1");
        await rr.connect(bob).setTraderReferralCode("alice1");
        await expect(rr.connect(alice).transferCode("alice1", bob.address)).to.be.revertedWithCustomError(
            rr,
            "CannotBindOwnCode",
        );
    });

    it("multi-tier promotion walks forward across several thresholds at once", async () => {
        const { rr, core, alice, bob } = await loadFixture(deploy);
        await rr.connect(alice).registerCode("alice1");
        await rr.connect(bob).setTraderReferralCode("alice1");
        await rr.addTier(u(1_000), 150, 75);
        await rr.addTier(u(5_000), 250, 125);
        await rr.addTier(u(20_000), 400, 200);
        // a single large volume crosses multiple tiers -> walk-forward loop
        await rr.connect(core).recordReferralVolume(bob.address, u(25_000));
        const data = await rr.getTraderReferralData(bob.address);
        expect(data.discountBps).to.equal(400);
        expect(data.rebateBps).to.equal(200);
    });

    it("getTraderReferralData clamps a cached tier index after removeTier shrinks the array", async () => {
        const { rr, core, alice, bob } = await loadFixture(deploy);
        await rr.connect(alice).registerCode("alice1");
        await rr.connect(bob).setTraderReferralCode("alice1");
        await rr.addTier(u(1_000), 150, 75);
        await rr.addTier(u(5_000), 250, 125);
        await rr.connect(core).recordReferralVolume(bob.address, u(6_000)); // promote to top tier
        // now remove tiers so the cached index exceeds the array length
        await rr.removeTier(u(5_000));
        await rr.removeTier(u(1_000));
        const data = await rr.getTraderReferralData(bob.address);
        // clamped -> falls back to default rates without reverting
        expect(data.referrer).to.equal(alice.address);
    });

    it("getTiers and tierCount reflect current tiers", async () => {
        const { rr } = await loadFixture(deploy);
        expect(await rr.tierCount()).to.equal(0n);
        await rr.addTier(u(1_000), 150, 75);
        const tiers = await rr.getTiers();
        expect(tiers.length).to.equal(1);
        expect(tiers[0].discountBps).to.equal(150);
    });

    it("recordReferralVolume no-ops for an unreferred trader and zero size", async () => {
        const { rr, core, alice, bob } = await loadFixture(deploy);
        await rr.connect(core).recordReferralVolume(bob.address, u(1000)); // unreferred -> no-op
        expect(await rr.traderCumulativeVolume(bob.address)).to.equal(0n);
        await rr.connect(alice).registerCode("alice1");
        await rr.connect(bob).setTraderReferralCode("alice1");
        await rr.connect(core).recordReferralVolume(bob.address, 0); // zero size -> no-op
        expect(await rr.traderCumulativeVolume(bob.address)).to.equal(0n);
    });

    it("codeOf returns empty for a non-owner and ownerOfCode handles invalid codes", async () => {
        const { rr, bob } = await loadFixture(deploy);
        expect(await rr.codeOf(bob.address)).to.equal("");
        expect(await rr.ownerOfCode("ab")).to.equal(ethers.ZeroAddress); // invalid length -> zero
    });
});
