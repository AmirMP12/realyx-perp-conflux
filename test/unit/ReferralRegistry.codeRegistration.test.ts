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

describe("ReferralRegistry — code registration", () => {
    describe("initialize guards", () => {
        it("reverts on zero admin", async () => {
            const RR = await ethers.getContractFactory("ReferralRegistry");
            await expect(
                upgrades.deployProxy(RR, [ethers.ZeroAddress, 100, 50], {
                    kind: "uups",
                    initializer: "initialize",
                }),
            ).to.be.revertedWithCustomError(RR, "ZeroAddress");
        });

        it("reverts when default rates exceed BPS", async () => {
            const RR = await ethers.getContractFactory("ReferralRegistry");
            const [admin] = await ethers.getSigners();
            await expect(
                upgrades.deployProxy(RR, [admin.address, 10001, 50], {
                    kind: "uups",
                    initializer: "initialize",
                }),
            ).to.be.revertedWithCustomError(RR, "InvalidParam");
        });
    });

    describe("registerCode", () => {
        it("reverts when caller already has a code", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(alice).registerCode("alice2")).to.be.revertedWithCustomError(
                rr,
                "AlreadyHasCode",
            );
        });

        it("reverts when the code is already taken by someone else", async () => {
            const { rr, alice, bob } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("shared1");
            await expect(rr.connect(bob).registerCode("SHARED1")).to.be.revertedWithCustomError(
                rr,
                "CodeAlreadyTaken",
            );
        });

        it("rejects too-short, too-long and invalid-character codes", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await expect(rr.connect(alice).registerCode("abc")).to.be.revertedWithCustomError(rr, "CodeTooShort");
            await expect(
                rr.connect(alice).registerCode("abcdefghijklmnopq"),
            ).to.be.revertedWithCustomError(rr, "CodeTooLong");
            await expect(rr.connect(alice).registerCode("ab!d")).to.be.revertedWithCustomError(
                rr,
                "InvalidCodeCharacters",
            );
        });
    });

    describe("setTraderReferralCode", () => {
        it("reverts when the code is not registered", async () => {
            const { rr, bob } = await loadFixture(deploy);
            await expect(rr.connect(bob).setTraderReferralCode("ghost1")).to.be.revertedWithCustomError(
                rr,
                "CodeNotRegistered",
            );
        });

        it("reverts when binding to your own code", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(alice).setTraderReferralCode("alice1")).to.be.revertedWithCustomError(
                rr,
                "CannotBindOwnCode",
            );
        });

        it("reverts when the trader is already bound", async () => {
            const { rr, alice, bob, carol } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await rr.connect(carol).registerCode("carol1");
            await rr.connect(bob).setTraderReferralCode("alice1");
            await expect(rr.connect(bob).setTraderReferralCode("carol1")).to.be.revertedWithCustomError(
                rr,
                "AlreadyBound",
            );
        });
    });

    describe("transferCode", () => {
        it("reverts on zero new owner", async () => {
            const { rr, alice } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(
                rr.connect(alice).transferCode("alice1", ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(rr, "ZeroAddress");
        });

        it("reverts when caller is not the code owner", async () => {
            const { rr, alice, bob, carol } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await expect(rr.connect(bob).transferCode("alice1", carol.address)).to.be.revertedWithCustomError(
                rr,
                "NotCodeOwner",
            );
        });

        it("reverts when the new owner already owns a code", async () => {
            const { rr, alice, bob } = await loadFixture(deploy);
            await rr.connect(alice).registerCode("alice1");
            await rr.connect(bob).registerCode("bob1234");
            await expect(rr.connect(alice).transferCode("alice1", bob.address)).to.be.revertedWithCustomError(
                rr,
                "AlreadyHasCode",
            );
        });
    });

    describe("addTier / removeTier guards", () => {
        it("addTier rejects bps above BPS", async () => {
            const { rr } = await loadFixture(deploy);
            await expect(rr.addTier(u(1000), 10001, 50)).to.be.revertedWithCustomError(rr, "InvalidTierConfig");
        });

        it("addTier rejects duplicate thresholds and inserts sorted", async () => {
            const { rr } = await loadFixture(deploy);
            await rr.addTier(u(5000), 250, 125);
            await rr.addTier(u(1000), 150, 75); // inserts before the first (sorted ascending)
            const tiers = await rr.getTiers();
            expect(tiers[0].minVolumeUsdc).to.equal(u(1000));
            expect(tiers[1].minVolumeUsdc).to.equal(u(5000));
            await expect(rr.addTier(u(1000), 200, 100)).to.be.revertedWithCustomError(rr, "TierAlreadyExists");
        });

        it("removeTier reverts when the threshold is not found", async () => {
            const { rr } = await loadFixture(deploy);
            await rr.addTier(u(1000), 150, 75);
            await expect(rr.removeTier(u(9999))).to.be.revertedWithCustomError(rr, "TierNotFound");
        });
    });

    describe("setDefaultRates", () => {
        it("rejects bps above BPS and updates otherwise", async () => {
            const { rr } = await loadFixture(deploy);
            await expect(rr.setDefaultRates(10001, 50)).to.be.revertedWithCustomError(rr, "InvalidParam");
            await expect(rr.setDefaultRates(300, 150)).to.emit(rr, "DefaultRatesUpdated").withArgs(300, 150);
            expect(await rr.defaultDiscountBps()).to.equal(300);
            expect(await rr.defaultRebateBps()).to.equal(150);
        });
    });

    describe("isCodeAvailable", () => {
        it("returns false for invalid codes and taken codes, true for free valid codes", async () => {
            const { rr, alice } = await loadFixture(deploy);
            expect(await rr.isCodeAvailable("ab")).to.equal(false); // too short -> invalid
            expect(await rr.isCodeAvailable("free01")).to.equal(true);
            await rr.connect(alice).registerCode("free01");
            expect(await rr.isCodeAvailable("FREE01")).to.equal(false); // taken
        });
    });
});
