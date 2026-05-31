import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { ADMIN_ROLE, OPERATOR_ROLE, GUARDIAN_ROLE, KEEPER_ROLE } from "../helpers/constants";

/**
 * AccessControlled is abstract; exercise it through VaultCore + OracleAggregator
 * (which inherit it) for role admin, batch grant/revoke, pausing, circuit-breaker
 * hub, and the UUPS upgrade timelock surface.
 */
describe("AccessControlled (base)", () => {
    describe("role bootstrap", () => {
        it("admin holds ADMIN_ROLE and DEFAULT_ADMIN_ROLE", async () => {
            const d = await loadFixture(deployProtocol);
            expect(await d.vault.hasRole(ADMIN_ROLE, d.admin.address)).to.equal(true);
            expect(await d.vault.hasRole(ethers.ZeroHash, d.admin.address)).to.equal(true);
        });
        it("ADMIN_ROLE is the admin of operational roles", async () => {
            const d = await loadFixture(deployProtocol);
            expect(await d.vault.getRoleAdmin(OPERATOR_ROLE)).to.equal(ADMIN_ROLE);
            expect(await d.vault.getRoleAdmin(GUARDIAN_ROLE)).to.equal(ADMIN_ROLE);
        });
    });

    describe("batch role mutation", () => {
        it("batchGrantRole grants to many and emits", async () => {
            const d = await loadFixture(deployProtocol);
            const accounts = [d.alice.address, d.bob.address, d.carol.address];
            await expect(d.vault.connect(d.admin).batchGrantRole(KEEPER_ROLE, accounts)).to.emit(
                d.vault,
                "RolesBatchUpdated",
            );
            for (const a of accounts) expect(await d.vault.hasRole(KEEPER_ROLE, a)).to.equal(true);
        });
        it("batchGrantRole reverts on zero address entry", async () => {
            const d = await loadFixture(deployProtocol);
            await expect(
                d.vault.connect(d.admin).batchGrantRole(KEEPER_ROLE, [ethers.ZeroAddress]),
            ).to.be.revertedWithCustomError(d.vault, "ZeroAddress");
        });
        it("batchGrantRole reverts above MAX_BATCH_SIZE", async () => {
            const d = await loadFixture(deployProtocol);
            const big = Array.from({ length: 51 }, () => ethers.Wallet.createRandom().address);
            await expect(d.vault.connect(d.admin).batchGrantRole(KEEPER_ROLE, big)).to.be.revertedWithCustomError(
                d.vault,
                "BatchSizeExceeded",
            );
        });
        it("batchRevokeRole revokes", async () => {
            const d = await loadFixture(deployProtocol);
            const accounts = [d.alice.address, d.bob.address];
            await d.vault.connect(d.admin).batchGrantRole(KEEPER_ROLE, accounts);
            await d.vault.connect(d.admin).batchRevokeRole(KEEPER_ROLE, accounts);
            for (const a of accounts) expect(await d.vault.hasRole(KEEPER_ROLE, a)).to.equal(false);
        });
        it("non-admin cannot batch grant", async () => {
            const d = await loadFixture(deployProtocol);
            await expect(
                d.vault.connect(d.alice).batchGrantRole(KEEPER_ROLE, [d.bob.address]),
            ).to.be.revertedWithCustomError(d.vault, "NotAdmin");
        });
    });

    describe("hasAnyRole", () => {
        it("true for the admin, false for a random account", async () => {
            const d = await loadFixture(deployProtocol);
            expect(await d.vault.hasAnyRole(d.admin.address)).to.equal(true);
            expect(await d.vault.hasAnyRole(d.carol.address)).to.equal(false);
        });
    });

    describe("pause / unpause", () => {
        it("guardian can pause, admin can unpause", async () => {
            const d = await loadFixture(deployProtocol);
            await d.vault.connect(d.guardian).pause();
            expect(await d.vault.paused()).to.equal(true);
            await d.vault.connect(d.admin).unpause();
            expect(await d.vault.paused()).to.equal(false);
        });
        it("non-admin cannot unpause", async () => {
            const d = await loadFixture(deployProtocol);
            await d.vault.connect(d.guardian).pause();
            await expect(d.vault.connect(d.guardian).unpause()).to.be.revertedWithCustomError(d.vault, "NotAdmin");
        });
        it("non-guardian/admin cannot pause", async () => {
            const d = await loadFixture(deployProtocol);
            await expect(d.vault.connect(d.alice).pause()).to.be.revertedWithCustomError(d.vault, "NotGuardian");
        });
    });

    describe("circuit breaker hub", () => {
        it("reverts zero address", async () => {
            const d = await loadFixture(deployProtocol);
            await expect(d.vault.connect(d.admin).setCircuitBreakerHub(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                d.vault,
                "ZeroAddress",
            );
        });
        it("sets and reads back the hub", async () => {
            const d = await loadFixture(deployProtocol);
            await expect(d.vault.connect(d.admin).setCircuitBreakerHub(d.bob.address)).to.emit(
                d.vault,
                "CircuitBreakerHubUpdated",
            );
            expect(await d.vault.circuitBreakerHub()).to.equal(d.bob.address);
        });
    });

    describe("UUPS upgrade timelock", () => {
        it("reverts proposeImplementation zero address", async () => {
            const d = await loadFixture(deployProtocol);
            await expect(d.vault.connect(d.admin).proposeImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                d.vault,
                "ZeroAddress",
            );
        });
        it("propose then cancel implementation", async () => {
            const d = await loadFixture(deployProtocol);
            const dummy = "0x00000000000000000000000000000000DeaDBeef";
            await expect(d.vault.connect(d.admin).proposeImplementation(dummy)).to.emit(d.vault, "ImplementationProposed");
            const [pending, eff] = await d.vault.pendingImplementation();
            expect(pending).to.equal(ethers.getAddress(dummy));
            expect(eff).to.be.greaterThan(0n);
            await expect(d.vault.connect(d.admin).cancelPendingImplementation()).to.emit(
                d.vault,
                "ImplementationCancelled",
            );
        });
    });
});
