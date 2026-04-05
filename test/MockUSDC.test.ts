import { expect } from "chai";
import { ethers } from "hardhat";

describe("MockUSDC - Full Coverage", function () {
    let usdc: any;
    let admin: any;
    let alice: any;

    beforeEach(async () => {
        [admin, alice] = await ethers.getSigners();
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();
    });

    it("should have 6 decimals", async function () {
        expect(await usdc.decimals()).to.equal(6);
    });

    it("should allow public mint within wallet cap", async function () {
        await usdc.connect(alice).mint(ethers.parseUnits("500", 6));
        expect(await usdc.balanceOf(alice.address)).to.equal(ethers.parseUnits("500", 6));
    });

    it("should revert mint exceeding wallet cap", async function () {
        await usdc.connect(alice).mint(ethers.parseUnits("1000", 6));
        await expect(usdc.connect(alice).mint(1)).to.be.reverted;
    });

    it("should revert mint of 0", async function () {
        await expect(usdc.connect(alice).mint(0)).to.be.reverted;
    });

    it("should allow owner to mintTo without cap", async function () {
        await usdc.connect(admin).mintTo(alice.address, ethers.parseUnits("10000", 6));
        expect(await usdc.balanceOf(alice.address)).to.equal(ethers.parseUnits("10000", 6));
    });

    it("should allow burn", async function () {
        await usdc.connect(alice).mint(ethers.parseUnits("500", 6));
        await usdc.connect(alice).burn(ethers.parseUnits("200", 6));
        expect(await usdc.balanceOf(alice.address)).to.equal(ethers.parseUnits("300", 6));
    });

    it("should allow faucet", async function () {
        await usdc.connect(alice).faucet();
        expect(await usdc.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 6));
    });

    it("should revert faucet when limit reached", async function () {
        await usdc.connect(alice).faucet();
        await expect(usdc.connect(alice).faucet()).to.be.reverted;
    });

    it("should track mintedAmount", async function () {
        await usdc.connect(alice).mint(ethers.parseUnits("500", 6));
        expect(await usdc.mintedAmount(alice.address)).to.equal(ethers.parseUnits("500", 6));
    });

    it("should report MAX_MINT_PER_WALLET", async function () {
        const max = await usdc.MAX_MINT_PER_WALLET();
        expect(max).to.equal(ethers.parseUnits("1000", 6));
    });
});
