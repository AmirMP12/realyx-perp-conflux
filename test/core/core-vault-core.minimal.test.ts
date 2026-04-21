import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { VaultCore, MockUSDC } from "../../typechain";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

type TestEnvironment = any;

describe("VaultCore Minimal Coverage", function () {
    let env: TestEnvironment;
    let vault: VaultCore;
    let usdc: MockUSDC;
    let admin: SignerWithAddress;
    let alice: SignerWithAddress;

    beforeEach(async function () {
        env = await deployTestEnvironment();
        vault = env.vault;
        usdc = env.usdc;
        admin = env.admin;
        alice = env.alice;

        const ADMIN_ROLE = await vault.ADMIN_ROLE();
        await vault.grantRole(ADMIN_ROLE, admin.address);
        
        await usdc.mintTo(alice.address, 10000e6);
        await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should test basics and views", async function () {
        await vault.connect(alice).deposit(1000e6, alice.address);
        expect(await vault.lpAssets()).to.be.gt(0);
        expect(await vault.lpTotalShares()).to.be.gt(0);
        expect(await vault.insTotalShares()).to.be.gt(0);
        expect(await vault.getLPSharePrice()).to.be.gt(0);
        expect(await vault.getConservativeUtilization()).to.equal(0);
        
        const shares = await vault.previewDeposit(500e6);
        expect(shares).to.be.gt(0);
        expect(await vault.previewWithdraw(shares)).to.be.gt(0);
    });
});
