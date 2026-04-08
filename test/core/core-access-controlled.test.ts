import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("AccessControlled - Extended Coverage", function () {
    let env: any;
    const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
    const LIQUIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("LIQUIDATOR_ROLE"));

    beforeEach(async () => {
        env = await deployTestEnvironment();
    });

    // ===== Role Assignment =====
    it("should grant and check GUARDIAN_ROLE", async function () {
        await env.vault.grantRole(GUARDIAN_ROLE, env.alice.address);
        expect(await env.vault.hasRole(GUARDIAN_ROLE, env.alice.address)).to.be.true;
    });

    it("should grant and revoke OPERATOR_ROLE", async function () {
        await env.vault.grantRole(OPERATOR_ROLE, env.alice.address);
        expect(await env.vault.hasRole(OPERATOR_ROLE, env.alice.address)).to.be.true;
        await env.vault.revokeRole(OPERATOR_ROLE, env.alice.address);
        expect(await env.vault.hasRole(OPERATOR_ROLE, env.alice.address)).to.be.false;
    });

    it("should support batchGrantRole", async function () {
        await env.vault.batchGrantRole(KEEPER_ROLE, [env.alice.address, env.bob.address]);
        expect(await env.vault.hasRole(KEEPER_ROLE, env.alice.address)).to.be.true;
        expect(await env.vault.hasRole(KEEPER_ROLE, env.bob.address)).to.be.true;
    });

    it("should support batchRevokeRole", async function () {
        await env.vault.batchGrantRole(KEEPER_ROLE, [env.alice.address, env.bob.address]);
        await env.vault.batchRevokeRole(KEEPER_ROLE, [env.alice.address, env.bob.address]);
        expect(await env.vault.hasRole(KEEPER_ROLE, env.alice.address)).to.be.false;
        expect(await env.vault.hasRole(KEEPER_ROLE, env.bob.address)).to.be.false;
    });

    it("should check hasAnyRole", async function () {
        await env.vault.grantRole(OPERATOR_ROLE, env.alice.address);
        const has = await env.vault.hasAnyRole(env.alice.address);
        expect(has).to.be.true;
    });

    it("should revert if non-admin tries to grant role", async function () {
        await expect(
            env.vault.connect(env.alice).grantRole(GUARDIAN_ROLE, env.bob.address)
        ).to.be.reverted;
    });

    // ===== Oracle Role Checks =====
    it("should grant roles on oracle and verify", async function () {
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        expect(await env.oracle.hasRole(GUARDIAN_ROLE, env.alice.address)).to.be.true;
    });

    it("should support oracle batch role operations", async function () {
        await env.oracle.batchGrantRole(OPERATOR_ROLE, [env.alice.address, env.bob.address]);
        expect(await env.oracle.hasRole(OPERATOR_ROLE, env.alice.address)).to.be.true;
    });

    // ===== TradingCore Role Checks =====
    it("should verify keeper role on TradingCore", async function () {
        expect(await env.trading.hasRole(KEEPER_ROLE, env.keeper.address)).to.be.true;
    });

    it("should verify liquidator role on TradingCore", async function () {
        expect(await env.trading.hasRole(LIQUIDATOR_ROLE, env.liquidator.address)).to.be.true;
    });
});
