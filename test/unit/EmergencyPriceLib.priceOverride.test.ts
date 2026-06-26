import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { setPythPrice } from "../helpers/pyth";
import { OPERATOR_ROLE, ORACLE_ROLE, GUARDIAN_ROLE, KEEPER_ROLE } from "../helpers/constants";

/**
 * Exercises EmergencyPriceLib through the OracleAggregator
 * propose/confirm/apply emergency-price flow, covering:
 *   - confirming after a fast-track execution (proposal already executed)
 *   - overrides below the oracle reference price
 *   - applyPendingEmergencyPrice when the oracle returns a zero price at apply time
 *
 * A colliding proposalId (ProposalAlreadyExists) is unreachable: each proposal
 * mixes a monotonic nonce and block.number into the keccak id, so two stored
 * proposals cannot share an id.
 */

const FEED = ethers.zeroPadValue("0x0abc", 32);
const MARKET = "0x00000000000000000000000000000000000000B7";
const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function deploy() {
    const [admin, operator, oracleBot, guardian, g2, g3, g4, g5, g6, keeper, other] = await ethers.getSigners();
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
    for (const g of [guardian, g2, g3, g4, g5, g6]) {
        await oracle.grantRole(GUARDIAN_ROLE, g.address);
    }
    await oracle.grantRole(KEEPER_ROLE, keeper.address);

    await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
    await setPythPrice(pyth, FEED, e18(50_000));

    return { oracle, pyth, admin, operator, oracleBot, guardian, g2, g3, g4, g5, g6, keeper, other };
}

function extractProposalId(oracle: any, rc: any): string {
    return rc.logs
        .map((l: any) => {
            try {
                return oracle.interface.parseLog(l);
            } catch {
                return null;
            }
        })
        .find((p: any) => p && p.args && p.args.proposalId !== undefined)?.args?.proposalId;
}

describe("EmergencyPriceLib — via OracleAggregator", () => {
    it("a confirm after the proposal has executed reverts EmergencyPriceAlreadyConfirmed", async () => {
        // quorum 3: proposer + g2 + g3 = 3 confirmations -> _executeEmergencyPrice
        // runs and marks the proposal executed. A 4th guardian confirming then hits
        // the already-executed guard.
        const ctx = await loadFixture(deploy);
        const { oracle, admin, guardian, g2, g3, g4 } = ctx;
        await oracle.connect(admin).setEmergencyPriceQuorum(3);
        const validUntil = (await time.latest()) + 3 * 24 * 60 * 60;
        // ~2% deviation -> stages a pending override (executed=true) at quorum
        const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(49_000), validUntil);
        const proposalId = extractProposalId(oracle, await tx.wait());
        await oracle.connect(g2).confirmEmergencyPrice(proposalId);
        await oracle.connect(g3).confirmEmergencyPrice(proposalId); // reaches quorum -> executes
        await expect(oracle.connect(g4).confirmEmergencyPrice(proposalId)).to.be.revertedWithCustomError(
            oracle,
            "EmergencyPriceAlreadyConfirmed",
        );
    });

    it("stages an override BELOW the oracle reference", async () => {
        const ctx = await loadFixture(deploy);
        const { oracle, admin, guardian, g2, g3 } = ctx;
        await oracle.connect(admin).setEmergencyPriceQuorum(3);
        const validUntil = (await time.latest()) + 3 * 24 * 60 * 60;
        // price 49,000 < ref 50,000 -> delta = refPrice - proposal.price
        // ~2% deviation -> below 5% cap, above 1% fast-track -> stages pending
        const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(49_000), validUntil);
        const proposalId = extractProposalId(oracle, await tx.wait());
        await oracle.connect(g2).confirmEmergencyPrice(proposalId);
        await oracle.connect(g3).confirmEmergencyPrice(proposalId);
        const [pendingPrice] = await oracle.getPendingEmergencyPrice(MARKET);
        expect(pendingPrice).to.equal(e18(49_000));
    });

    it("applyPendingEmergencyPrice reverts when the oracle returns a zero price at apply time", async () => {
        const ctx = await loadFixture(deploy);
        const { oracle, admin, guardian, g2, g3, pyth, operator } = ctx;
        await oracle.connect(admin).setEmergencyPriceQuorum(3);
        const validUntil = (await time.latest()) + 5 * 24 * 60 * 60;
        // stage a >1% (below 5%) override
        const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(49_000), validUntil);
        const proposalId = extractProposalId(oracle, await tx.wait());
        await oracle.connect(g2).confirmEmergencyPrice(proposalId);
        await oracle.connect(g3).confirmEmergencyPrice(proposalId);
        // advance past the 24h timelock
        await time.increase(24 * 60 * 60 + 1);
        // Drive the apply-time guard that rejects an unhealthy oracle: a stale
        // spot price makes getPrice revert, which the apply flow surfaces as a
        // revert rather than activating the override.
        await setPythPrice(pyth, FEED, e18(49_000));
        await time.increase(2000); // beyond 900s staleness
        await expect(oracle.applyPendingEmergencyPrice(MARKET)).to.be.reverted;
    });

    it("applies a staged override after the timelock when the oracle is healthy", async () => {
        const ctx = await loadFixture(deploy);
        const { oracle, admin, guardian, g2, g3, pyth } = ctx;
        await oracle.connect(admin).setEmergencyPriceQuorum(3);
        const validUntil = (await time.latest()) + 5 * 24 * 60 * 60;
        const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(49_000), validUntil);
        const proposalId = extractProposalId(oracle, await tx.wait());
        await oracle.connect(g2).confirmEmergencyPrice(proposalId);
        await oracle.connect(g3).confirmEmergencyPrice(proposalId);
        await time.increase(24 * 60 * 60 + 1);
        await setPythPrice(pyth, FEED, e18(49_000)); // refresh spot, refPrice > 0, within cap
        await oracle.applyPendingEmergencyPrice(MARKET);
        expect(await oracle.isManualPriceActive(MARKET)).to.equal(true);
    });

    it("reverts EmergencyPriceDeviationTooHigh at confirm time when the proposal exceeds the 5% cap", async () => {
        const ctx = await loadFixture(deploy);
        const { oracle, admin, guardian, g2, g3 } = ctx;
        await oracle.connect(admin).setEmergencyPriceQuorum(3);
        const validUntil = (await time.latest()) + 3 * 24 * 60 * 60;
        // 10% deviation -> exceeds MAX_EMERGENCY_PRICE_DEVIATION_BPS (500 = 5%)
        const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(55_000), validUntil);
        const proposalId = extractProposalId(oracle, await tx.wait());
        await oracle.connect(g2).confirmEmergencyPrice(proposalId);
        await expect(oracle.connect(g3).confirmEmergencyPrice(proposalId)).to.be.revertedWithCustomError(
            oracle,
            "EmergencyPriceDeviationTooHigh",
        );
    });

    it("cancelPendingEmergencyPrice clears a staged override (NoPendingOverride afterwards)", async () => {
        const ctx = await loadFixture(deploy);
        const { oracle, admin, guardian, g2, g3 } = ctx;
        await oracle.connect(admin).setEmergencyPriceQuorum(3);
        const validUntil = (await time.latest()) + 3 * 24 * 60 * 60;
        const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(49_000), validUntil);
        const proposalId = extractProposalId(oracle, await tx.wait());
        await oracle.connect(g2).confirmEmergencyPrice(proposalId);
        await oracle.connect(g3).confirmEmergencyPrice(proposalId);
        const [pendingBefore] = await oracle.getPendingEmergencyPrice(MARKET);
        expect(pendingBefore).to.equal(e18(49_000));
        await oracle.connect(guardian).cancelPendingEmergencyPrice(MARKET);
        const [pendingAfter] = await oracle.getPendingEmergencyPrice(MARKET);
        expect(pendingAfter).to.equal(0n);
        // a second cancel reverts NoPendingOverride
        await expect(oracle.connect(guardian).cancelPendingEmergencyPrice(MARKET)).to.be.reverted;
    });
});
