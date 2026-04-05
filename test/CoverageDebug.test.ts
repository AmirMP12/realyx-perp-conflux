import { ethers } from "hardhat";
import { expect } from "chai";

describe("Coverage Debug", function () {
    it("should deploy a simple contract", async function () {
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        const usdc = await MockUSDC.deploy();
        expect(await usdc.getAddress()).to.be.properAddress;
    });
});
