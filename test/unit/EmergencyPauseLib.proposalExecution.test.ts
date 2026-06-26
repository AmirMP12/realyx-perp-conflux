import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { OPERATOR_ROLE, ORACLE_ROLE, GUARDIAN_ROLE } from "../helpers/constants";

// EmergencyPauseLib is an internal library inlined into OracleAggregator.
// These tests drive its execution paths through the propose/confirm
// emergency-pause flow exposed by OracleAggregator.

async function deploy() {
    const [admin, operator, oracleBot, guardian, g2, g3, other] = await ethers.getSigners();
    const MockPyth = await ethers.getContractFactory("MockPythWrapper");
    const pyth = await MockPyth.deploy(3600, 1);
    await pyth.waitForDeployment();

    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    const oracle = await upgrades.deployProxy(OracleAggregator, [admin.address, await pyth.getAddress()], {
        kind: "uups",
        initializer: "initialize",
    });
    await oracle.waitForDeployment();

    await oracle.grantRole(OPERATOR_ROLE, operator.address);
    await oracle.grantRole(ORACLE_ROLE, oracleBot.address);
    await oracle.grantRole(GUARDIAN_ROLE, guardian.address);
    await oracle.grantRole(GUARDIAN_ROLE, g2.address);
    await oracle.grantRole(GUARDIAN_ROLE, g3.address);

    return { oracle, pyth, admin, operator, oracleBot, guardian, g2, g3, other };
}

async function proposePauseId(oracle: any, signer: any, targets: string[]) {
    const tx = await oracle.connect(signer).proposeEmergencyPause(targets, "incident");
    const rc = await tx.wait();
    const pauseId = rc!.logs
        .map((l: any) => {
            try {
                return oracle.interface.parseLog(l);
            } catch {
                return null;
            }
        })
        .find((p: any) => p && p.args && p.args.pauseId !== undefined)?.args?.pauseId;
    return pauseId;
}

describe("EmergencyPauseLib", () => {
    // Confirming an unknown pauseId reverts ProposalNotFound.
    it("confirmEmergencyPause reverts ProposalNotFound for an unknown id", async () => {
        const { oracle, guardian } = await loadFixture(deploy);
        const bogus = ethers.keccak256(ethers.toUtf8Bytes("does-not-exist"));
        await expect(
            oracle.connect(guardian).confirmEmergencyPause(bogus),
        ).to.be.revertedWithCustomError(oracle, "ProposalNotFound");
    });

    // A target that was never registered as pausable is skipped during execution.
    it("execution skips targets that are not registered as pausable", async () => {
        const { oracle, guardian, g2, g3 } = await loadFixture(deploy);
        const Pausable = await ethers.getContractFactory("MockPausableForEmergency");
        const p = await Pausable.deploy();
        await p.waitForDeployment();
        const addr = await p.getAddress();
        // NOTE: intentionally NOT registered via registerPausable.

        const pauseId = await proposePauseId(oracle, guardian, [addr]);
        await oracle.connect(g2).confirmEmergencyPause(pauseId);
        await oracle.connect(g3).confirmEmergencyPause(pauseId); // reaches quorum 3, executes

        // Skipped because pausables[addr] is false -> never paused.
        expect(await p.paused()).to.equal(false);
        expect(await oracle.failedPauseCount()).to.equal(0n);
    });

    // A target that fails pause() a SECOND time is already in failedTargets, so
    // it is not pushed to the failed list again.
    it("a repeat-failing target is not double-counted in the failed list", async () => {
        const { oracle, admin, guardian, g2, g3 } = await loadFixture(deploy);
        const Reverting = await ethers.getContractFactory("MockPausableRevertOnPause");
        const r = await Reverting.deploy();
        await r.waitForDeployment();
        const addr = await r.getAddress();
        await oracle.connect(admin).registerPausable(addr);

        // First execution: target fails -> recorded (failedTargets[addr] = true).
        const id1 = await proposePauseId(oracle, guardian, [addr]);
        await oracle.connect(g2).confirmEmergencyPause(id1);
        await oracle.connect(g3).confirmEmergencyPause(id1);
        expect(await oracle.failedPauseCount()).to.equal(1n);

        // Second execution (distinct pauseId): target fails again, but
        // failedTargets[addr] is already true -> not pushed again.
        const id2 = await proposePauseId(oracle, guardian, [addr]);
        await oracle.connect(g2).confirmEmergencyPause(id2);
        await oracle.connect(g3).confirmEmergencyPause(id2);
        expect(await oracle.failedPauseCount()).to.equal(1n);
    });
});
