import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

async function deploy() {
    const [admin, alice, bob, other] = await ethers.getSigners();
    const AllowListCompliance = await ethers.getContractFactory("AllowListCompliance");
    const c = await upgrades.deployProxy(AllowListCompliance, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await c.waitForDeployment();
    return { c, admin, alice, bob, other };
}

describe("AllowListCompliance", () => {
    it("isAllowed false by default", async () => {
        const { c, alice } = await loadFixture(deploy);
        expect(await c.isAllowed(alice.address, ethers.ZeroAddress, "0x")).to.equal(false);
    });

    it("whitelists a user", async () => {
        const { c, alice } = await loadFixture(deploy);
        await expect(c.setWhitelist(alice.address, true)).to.emit(c, "UserWhitelisted");
        expect(await c.isAllowed(alice.address, ethers.ZeroAddress, "0x")).to.equal(true);
    });

    it("country-blocked user is not allowed even if whitelisted", async () => {
        const { c, alice } = await loadFixture(deploy);
        await c.setWhitelist(alice.address, true);
        await expect(c.setUserCountryBlocked(alice.address, true)).to.emit(c, "UserCountryBlockUpdated");
        expect(await c.isAllowed(alice.address, ethers.ZeroAddress, "0x")).to.equal(false);
    });

    it("batch whitelist", async () => {
        const { c, alice, bob } = await loadFixture(deploy);
        await expect(c.batchSetWhitelist([alice.address, bob.address], true)).to.emit(c, "WhitelistBatchUpdated");
        expect(await c.isWhitelisted(alice.address)).to.equal(true);
        expect(await c.isWhitelisted(bob.address)).to.equal(true);
    });

    it("batch reverts above max batch size", async () => {
        const { c } = await loadFixture(deploy);
        const big = Array.from({ length: 51 }, () => ethers.Wallet.createRandom().address);
        await expect(c.batchSetWhitelist(big, true)).to.be.revertedWithCustomError(c, "BatchSizeExceeded");
    });

    it("only manager can mutate", async () => {
        const { c, other, alice } = await loadFixture(deploy);
        await expect(c.connect(other).setWhitelist(alice.address, true)).to.be.reverted;
    });

    it("registerMarket is a no-op gated by manager", async () => {
        const { c, alice } = await loadFixture(deploy);
        await c.registerMarket(alice.address); // admin/manager ok
        await expect(c.connect(alice).registerMarket(alice.address)).to.be.reverted;
    });

    describe("upgrade timelock", () => {
        it("propose / cancel", async () => {
            const { c } = await loadFixture(deploy);
            const dummy = "0x00000000000000000000000000000000DeaDBeef";
            await expect(c.proposeImplementation(dummy)).to.emit(c, "ImplementationProposed");
            await expect(c.cancelPendingImplementation()).to.emit(c, "ImplementationCancelled");
        });
        it("reverts zero address proposal", async () => {
            const { c } = await loadFixture(deploy);
            await expect(c.proposeImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(c, "ZeroAddress");
        });
    });
});
