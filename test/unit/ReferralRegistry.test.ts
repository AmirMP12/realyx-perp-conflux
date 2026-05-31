import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { TRADING_CORE_ROLE } from "../helpers/constants";

async function deploy() {
    const [admin, core, alice, bob, carol] = await ethers.getSigners();
    const ReferralRegistry = await ethers.getContractFactory("ReferralRegistry");
    const rr = await upgrades.deployProxy(ReferralRegistry, [admin.address, 100, 50], {
        kind: "uups",
        initializer: "initialize",
    });
    await rr.waitForDeployment();
    // grant TradingCore role to `core` so it can record volume
    await rr.grantRole(TRADING_CORE_ROLE, core.address);
    return { rr, admin, core, alice, bob, carol };
}

describe("ReferralRegistry", () => {
    describe("initialize", () => {
        it("rejects default bps over 100%", async () => {
            const [admin] = await ethers.getSigners();
            const RR = await ethers.getContractFactory("ReferralRegistry");
            await expect(
                upgrades.deployProxy(RR, [admin.address, 10001, 0], { kind: "uups", initializer: "initialize" }),
            ).to.be.reverted;
        });
        it("sets default rates", async () => {
            const { rr } = await loadFixture(deploy);
            expect(await rr.defaultDiscountBps()).to.equal(100);
            expect(await rr.defaultRebateBps()).to.equal(50);
        });
    });

    describe("registerCode", () => {
        it("reverts on too-short code", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await expect(rr.connect(alice).registerCode("ab")).to.be.revertedWithCustomError(rr, "CodeTooShort");
        });
        it("reverts on too-long code", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await expect(rr.connect(alice).registerCode("a".repeat(17))).to.be.revertedWithCustomError(
                rr,
                "CodeTooLong",
            );
        });
        it("reverts on invalid characters", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await expect(rr.connect(alice).registerCode("ab!d")).to.be.revertedWithCustomError(
                rr,
                "InvalidCodeCharacters",
            );
        });
        it("registers and is case-insensitive", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await expect(rr.connect(alice).registerCode("Alice1")).to.emit(rr, "ReferralCodeRegistered");
            expect(await rr.ownerOfCode("ALICE1")).to.equal(alice.address);
            expect(await rr.ownerOfCode("alice1")).to.equal(alice.address);
            expect(await rr.codeOf(alice.address)).to.equal("ALICE1");
        });
        it("reverts when affiliate already has a code", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(alice).registerCode("alice2")).to.be.revertedWithCustomError(
                rr,
                "AlreadyHasCode",
            );
        });
        it("reverts when code already taken", async () => {
            const { rr, alice, bob } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("shared");
            await expect(rr.connect(bob).registerCode("SHARED")).to.be.revertedWithCustomError(
                rr,
                "CodeAlreadyTaken",
            );
        });
        it("isCodeAvailable reflects state and validity", async () => {
            const { rr, alice } = await loadFixture(deploy);
            expect(await rr.isCodeAvailable("free1")).to.equal(true);
            expect(await rr.isCodeAvailable("ab")).to.equal(false); // invalid length
            await rr.connect(alice).registerCode("free1");
            expect(await rr.isCodeAvailable("free1")).to.equal(false);
        });
    });

    describe("setTraderReferralCode", () => {
        it("reverts binding to an unregistered code", async () => {
            const { rr, bob } = await loadFixture(deploy);
            await expect(rr.connect(bob).setTraderReferralCode("nope1")).to.be.revertedWithCustomError(
                rr,
                "CodeNotRegistered",
            );
        });
        it("reverts binding to own code", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(alice).setTraderReferralCode("alice1")).to.be.revertedWithCustomError(
                rr,
                "CannotBindOwnCode",
            );
        });
        it("binds and exposes referrer + referee count", async () => {
            const { rr, alice, bob } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(bob).setTraderReferralCode("alice1")).to.emit(rr, "ReferralBound");
            expect(await rr.getReferrer(bob.address)).to.equal(alice.address);
        });
        it("reverts on double binding", async () => {
            const { rr, alice, bob } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await rr.connect(bob).setTraderReferralCode("alice1");
            await expect(rr.connect(bob).setTraderReferralCode("alice1")).to.be.revertedWithCustomError(
                rr,
                "AlreadyBound",
            );
        });
    });

    describe("transferCode", () => {
        it("reverts to zero address", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(alice).transferCode("alice1", ethers.ZeroAddress)).to.be.revertedWithCustomError(
                rr,
                "ZeroAddress",
            );
        });
        it("reverts when not code owner", async () => {
            const { rr, alice, bob, carol } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(bob).transferCode("alice1", carol.address)).to.be.revertedWithCustomError(
                rr,
                "NotCodeOwner",
            );
        });
        it("transfers ownership", async () => {
            const { rr, alice, carol } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(alice).transferCode("alice1", carol.address)).to.emit(
                rr,
                "ReferralCodeTransferred",
            );
            expect(await rr.ownerOfCode("alice1")).to.equal(carol.address);
            expect(await rr.codeOf(alice.address)).to.equal("");
        });
    });

    describe("tier management", () => {
        it("only admin can add tiers", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await expect(rr.connect(alice).addTier(1000, 50, 25)).to.be.revertedWithCustomError(rr, "NotAdmin");
        });
        it("rejects bps over 100%", async () => {
            const { rr } = await loadFixture(deploy);
            await expect(rr.addTier(1000, 10001, 0)).to.be.revertedWithCustomError(rr, "InvalidTierConfig");
        });
        it("keeps tiers sorted ascending by threshold", async () => {
            const { rr } = await loadFixture(deploy);
            await rr.addTier(ethers.parseUnits("100000", 6), 50, 25);
            await rr.addTier(ethers.parseUnits("10000", 6), 30, 15);
            await rr.addTier(ethers.parseUnits("1000000", 6), 100, 50);
            const tiers = await rr.getTiers();
            expect(tiers[0].minVolumeUsdc).to.equal(ethers.parseUnits("10000", 6));
            expect(tiers[1].minVolumeUsdc).to.equal(ethers.parseUnits("100000", 6));
            expect(tiers[2].minVolumeUsdc).to.equal(ethers.parseUnits("1000000", 6));
            expect(await rr.tierCount()).to.equal(3n);
        });
        it("reverts adding a duplicate threshold", async () => {
            const { rr } = await loadFixture(deploy);
            await rr.addTier(1000, 50, 25);
            await expect(rr.addTier(1000, 60, 30)).to.be.revertedWithCustomError(rr, "TierAlreadyExists");
        });
        it("removes a tier by threshold", async () => {
            const { rr } = await loadFixture(deploy);
            await rr.addTier(1000, 50, 25);
            await rr.addTier(2000, 60, 30);
            await expect(rr.removeTier(1000)).to.emit(rr, "TierRemoved");
            expect(await rr.tierCount()).to.equal(1n);
        });
        it("reverts removing a missing tier", async () => {
            const { rr } = await loadFixture(deploy);
            await expect(rr.removeTier(9999)).to.be.revertedWithCustomError(rr, "TierNotFound");
        });
    });

    describe("recordReferralVolume + tier progression", () => {
        it("only TradingCore can record", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await expect(rr.connect(alice).recordReferralVolume(alice.address, 1)).to.be.reverted;
        });
        it("no-ops for unreferred traders", async () => {
            const { rr, core, bob } = await loadFixture(deploy);
            await rr.connect(core).recordReferralVolume(bob.address, 1000);
            expect(await rr.traderCumulativeVolume(bob.address)).to.equal(0n);
        });
        it("accumulates volume and promotes tiers", async () => {
            const { rr, core, alice, bob } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await rr.connect(bob).setTraderReferralCode("alice1");
            await rr.addTier(ethers.parseUnits("1000", 6), 200, 100);
            await rr.connect(core).recordReferralVolume(bob.address, ethers.parseUnits("500", 6));
            let data = await rr.getTraderReferralData(bob.address);
            expect(data.discountBps).to.equal(100); // still default
            await expect(rr.connect(core).recordReferralVolume(bob.address, ethers.parseUnits("600", 6))).to.emit(
                rr,
                "TierUpgraded",
            );
            data = await rr.getTraderReferralData(bob.address);
            expect(data.discountBps).to.equal(200);
            expect(data.rebateBps).to.equal(100);
        });
    });

    describe("getTraderReferralData", () => {
        it("returns empty for unreferred", async () => {
            const { rr, bob } = await loadFixture(deploy);
            const data = await rr.getTraderReferralData(bob.address);
            expect(data.referrer).to.equal(ethers.ZeroAddress);
        });
        it("returns default rates for referred trader at base tier", async () => {
            const { rr, alice, bob } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await rr.connect(bob).setTraderReferralCode("alice1");
            const data = await rr.getTraderReferralData(bob.address);
            expect(data.referrer).to.equal(alice.address);
            expect(data.discountBps).to.equal(100);
            expect(data.rebateBps).to.equal(50);
        });
    });

    describe("setDefaultRates", () => {
        it("rejects bps over 100%", async () => {
            const { rr } = await loadFixture(deploy);
            await expect(rr.setDefaultRates(10001, 0)).to.be.revertedWithCustomError(rr, "InvalidParam");
        });
        it("updates defaults", async () => {
            const { rr } = await loadFixture(deploy);
            await expect(rr.setDefaultRates(200, 100)).to.emit(rr, "DefaultRatesUpdated");
            expect(await rr.defaultDiscountBps()).to.equal(200);
        });
    });
});
