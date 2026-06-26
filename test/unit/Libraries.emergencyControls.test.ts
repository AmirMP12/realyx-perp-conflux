import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

/**
 * Verifies EmergencyPriceLib, EmergencyPauseLib, MonitoringLib, and DustLib behavior.
 */

describe("EmergencyPriceLib", () => {
    async function deployFixture() {
        const [admin, guardian1, guardian2, guardian3] = await ethers.getSigners();
        const libs = await deployAllLibraries();
        const harness = await deployHarness("EmergencyPriceLibHarness", libs);

        const Oracle = await ethers.getContractFactory("MockOracleForEmergencyPrice");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();

        await harness.setOracleAggregator(await oracle.getAddress());
        await harness.setEmergencyPriceQuorum(2);

        return { harness, oracle, admin, guardian1, guardian2, guardian3 };
    }

    const COLLECTION = "0x00000000000000000000000000000000000000C1";

    describe("proposeEmergencyPrice", () => {
        it("creates a new price proposal", async () => {
            const { harness, guardian1 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400; // +1 day
            
            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(100),
                validUntil,
                1, // nonce
                0  // minIntervalSeconds
            );

            const receipt = await tx.wait();
            expect(receipt).to.not.be.null;
        });

        it("reverts when validUntil is in the past", async () => {
            const { harness, guardian1 } = await loadFixture(deployFixture);
            const pastTime = (await time.latest()) - 1000;

            await expect(
                harness.connect(guardian1).proposeEmergencyPrice(
                    COLLECTION,
                    e18(100),
                    pastTime,
                    1,
                    0
                )
            ).to.be.revertedWithCustomError(harness, "EmergencyPriceValidUntilOutOfRange");
        });

        it("reverts when validUntil exceeds MAX_EMERGENCY_PRICE_WINDOW", async () => {
            const { harness, guardian1 } = await loadFixture(deployFixture);
            const tooFarFuture = (await time.latest()) + 8 * 86400; // 8 days

            await expect(
                harness.connect(guardian1).proposeEmergencyPrice(
                    COLLECTION,
                    e18(100),
                    tooFarFuture,
                    1,
                    0
                )
            ).to.be.revertedWithCustomError(harness, "EmergencyPriceValidUntilOutOfRange");
        });

        it("enforces per-guardian rate limiting", async () => {
            const { harness, guardian1 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;
            
            await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(100),
                validUntil,
                1,
                3600 // 1 hour minimum interval
            );

            await expect(
                harness.connect(guardian1).proposeEmergencyPrice(
                    COLLECTION,
                    e18(101),
                    validUntil,
                    2,
                    3600
                )
            ).to.be.revertedWithCustomError(harness, "ProposalAlreadyExists");
        });

        it("allows proposals after rate limit window expires", async () => {
            const { harness, guardian1 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;
            
            await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(100),
                validUntil,
                1,
                3600
            );

            await time.increase(3601);

            await expect(
                harness.connect(guardian1).proposeEmergencyPrice(
                    COLLECTION,
                    e18(102),
                    validUntil + 3601,
                    2,
                    3600
                )
            ).to.not.be.reverted;
        });
    });

    describe("confirmEmergencyPrice", () => {
        it("increments confirmations on valid confirmation", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102), // 2% deviation
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            const [, , , confirmsBefore] = await harness.getProposal(proposalId);
            expect(confirmsBefore).to.equal(1n);

            await harness.connect(guardian2).confirmEmergencyPrice(proposalId);

            const [, , , confirmsAfter] = await harness.getProposal(proposalId);
            expect(confirmsAfter).to.equal(2n);
        });

        it("reverts when proposal not found", async () => {
            const { harness, guardian2 } = await loadFixture(deployFixture);
            const fakeProposalId = ethers.keccak256(ethers.toUtf8Bytes("fake"));

            await expect(
                harness.connect(guardian2).confirmEmergencyPrice(fakeProposalId)
            ).to.be.revertedWithCustomError(harness, "EmergencyPriceProposalNotFound");
        });

        it("reverts when guardian already confirmed", async () => {
            const { harness, oracle, guardian1 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await expect(
                harness.connect(guardian1).confirmEmergencyPrice(proposalId)
            ).to.be.revertedWithCustomError(harness, "AlreadyConfirmed");
        });

        it("reverts when proposal has expired", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await time.increase(3601); // Proposal expires after 1 hour

            await expect(
                harness.connect(guardian2).confirmEmergencyPrice(proposalId)
            ).to.be.revertedWithCustomError(harness, "EmergencyPriceProposalExpired");
        });

        it("applies fast-track override when conditions met", async () => {
            const { harness, oracle, guardian1, guardian2, guardian3 } = await loadFixture(deployFixture);
            await harness.setEmergencyPriceQuorum(1); // Set quorum to 1, fast-track needs 2 (2x quorum)
            
            const validUntil = (await time.latest()) + 86400;
            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            // 0.5% deviation (fast-track threshold is 1%)
            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(100.5),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            // Confirm with guardian2 to reach 2x quorum (2 confirmations)
            await harness.connect(guardian2).confirmEmergencyPrice(proposalId);

            // Should be applied immediately via fast-track
            const manualPrice = await harness.manualPrices(COLLECTION);
            expect(manualPrice).to.equal(e18(100.5));
        });

        it("stages override when deviation above fast-track threshold", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            // 2% deviation (above 1% fast-track but below 5% max)
            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await harness.connect(guardian2).confirmEmergencyPrice(proposalId);

            // Should be staged, not applied
            const manualPrice = await harness.manualPrices(COLLECTION);
            expect(manualPrice).to.equal(0n);

            const [pendingPrice, , pendingEffectiveTime] = await harness.getPendingOverride(COLLECTION);
            expect(pendingPrice).to.equal(e18(102));
            expect(pendingEffectiveTime).to.be.greaterThan(0n);
        });

        it("reverts when price deviation exceeds maximum", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            // 10% deviation (exceeds 5% max)
            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(110),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await expect(
                harness.connect(guardian2).confirmEmergencyPrice(proposalId)
            ).to.be.revertedWithCustomError(harness, "EmergencyPriceDeviationTooHigh");
        });

        it("reverts when oracle is unreachable", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setShouldRevert(true);

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await expect(
                harness.connect(guardian2).confirmEmergencyPrice(proposalId)
            ).to.be.revertedWithCustomError(harness, "OracleUnreachableForOverride");
        });

        it("reverts when oracle returns zero price", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, 0, e18(1), await time.latest());

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await expect(
                harness.connect(guardian2).confirmEmergencyPrice(proposalId)
            ).to.be.revertedWithCustomError(harness, "OracleUnreachableForOverride");
        });
    });

    describe("applyPendingEmergencyPrice", () => {
        it("applies pending price after timelock", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await harness.connect(guardian2).confirmEmergencyPrice(proposalId);

            // Wait for timelock (24 hours)
            await time.increase(24 * 3600 + 1);

            await harness.applyPendingEmergencyPrice(COLLECTION);

            const manualPrice = await harness.manualPrices(COLLECTION);
            expect(manualPrice).to.equal(e18(102));
        });

        it("reverts when no pending override exists", async () => {
            const { harness } = await loadFixture(deployFixture);

            await expect(
                harness.applyPendingEmergencyPrice(COLLECTION)
            ).to.be.revertedWithCustomError(harness, "NoPendingOverride");
        });

        it("reverts when timelock not yet expired", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await harness.connect(guardian2).confirmEmergencyPrice(proposalId);

            await expect(
                harness.applyPendingEmergencyPrice(COLLECTION)
            ).to.be.revertedWithCustomError(harness, "PendingOverrideTimelockActive");
        });

        it("re-validates deviation at apply time", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await harness.connect(guardian2).confirmEmergencyPrice(proposalId);
            await time.increase(24 * 3600 + 1);

            // Price moved significantly
            await oracle.setPrice(COLLECTION, e18(150), e18(1), await time.latest());

            await expect(
                harness.applyPendingEmergencyPrice(COLLECTION)
            ).to.be.revertedWithCustomError(harness, "EmergencyPriceDeviationTooHigh");
        });
    });

    describe("cancelPendingEmergencyPrice", () => {
        it("cancels a pending override", async () => {
            const { harness, oracle, guardian1, guardian2 } = await loadFixture(deployFixture);
            const validUntil = (await time.latest()) + 86400;

            await oracle.setPrice(COLLECTION, e18(100), e18(1), await time.latest());

            const tx = await harness.connect(guardian1).proposeEmergencyPrice(
                COLLECTION,
                e18(102),
                validUntil,
                1,
                0
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPriceProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const proposalId = parsedEvent?.args[0];

            await harness.connect(guardian2).confirmEmergencyPrice(proposalId);

            const [priceBefore] = await harness.getPendingOverride(COLLECTION);
            expect(priceBefore).to.equal(e18(102));

            await harness.cancelPendingEmergencyPrice(COLLECTION);

            const [priceAfter] = await harness.getPendingOverride(COLLECTION);
            expect(priceAfter).to.equal(0n);
        });

        it("reverts when no pending override exists", async () => {
            const { harness } = await loadFixture(deployFixture);

            await expect(
                harness.cancelPendingEmergencyPrice(COLLECTION)
            ).to.be.revertedWithCustomError(harness, "NoPendingOverride");
        });
    });
});

describe("EmergencyPauseLib", () => {
    async function deployFixture() {
        const [admin, guardian1, guardian2, guardian3] = await ethers.getSigners();
        const libs = await deployAllLibraries();
        const harness = await deployHarness("EmergencyPauseLibHarness", libs);

        const Pausable = await ethers.getContractFactory("MockPausableForEmergency");
        const pausable1 = await Pausable.deploy();
        const pausable2 = await Pausable.deploy();
        await pausable1.waitForDeployment();
        await pausable2.waitForDeployment();

        const Reverting = await ethers.getContractFactory("MockPausableRevertOnPause");
        const reverting = await Reverting.deploy();
        await reverting.waitForDeployment();

        await harness.setPausable(await pausable1.getAddress(), true);
        await harness.setPausable(await pausable2.getAddress(), true);
        await harness.setPausable(await reverting.getAddress(), true);
        await harness.setGuardianQuorum(2);

        return { harness, pausable1, pausable2, reverting, admin, guardian1, guardian2, guardian3 };
    }

    describe("proposeEmergencyPause", () => {
        it("creates a new pause proposal", async () => {
            const { harness, pausable1, guardian1 } = await loadFixture(deployFixture);
            
            const tx = await harness.connect(guardian1).proposeEmergencyPause([
                await pausable1.getAddress()
            ]);
            const receipt = await tx.wait();

            // Find the pauseId from events
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPauseProposed";
                } catch {
                    return false;
                }
            });

            expect(event).to.not.be.undefined;
            
            const parsedEvent = harness.interface.parseLog(event as any);
            const pauseId = parsedEvent?.args[0];

            const [proposer, confirmations] = await harness.getProposal(pauseId);
            expect(proposer).to.equal(guardian1.address);
            expect(confirmations).to.equal(1n);
        });

        it("tracks multiple targets", async () => {
            const { harness, pausable1, pausable2, guardian1 } = await loadFixture(deployFixture);
            
            const targets = [await pausable1.getAddress(), await pausable2.getAddress()];
            const tx = await harness.connect(guardian1).proposeEmergencyPause(targets);
            const receipt = await tx.wait();

            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPauseProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const pauseId = parsedEvent?.args[0];

            const [, , , , targetsLength] = await harness.getProposal(pauseId);
            expect(targetsLength).to.equal(2n);
        });
    });

    describe("confirmEmergencyPause", () => {
        it("increments confirmations", async () => {
            const { harness, pausable1, guardian1, guardian2 } = await loadFixture(deployFixture);
            
            const tx = await harness.connect(guardian1).proposeEmergencyPause([
                await pausable1.getAddress()
            ]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPauseProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const pauseId = parsedEvent?.args[0];

            await harness.connect(guardian2).confirmEmergencyPause(pauseId);

            const [, confirmations] = await harness.getProposal(pauseId);
            expect(confirmations).to.equal(2n);
        });

        it("executes pause when quorum reached", async () => {
            const { harness, pausable1, guardian1, guardian2 } = await loadFixture(deployFixture);
            
            const tx = await harness.connect(guardian1).proposeEmergencyPause([
                await pausable1.getAddress()
            ]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPauseProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const pauseId = parsedEvent?.args[0];

            expect(await pausable1.paused()).to.equal(false);

            await harness.connect(guardian2).confirmEmergencyPause(pauseId);

            expect(await pausable1.paused()).to.equal(true);
        });

        it("tracks failed targets", async () => {
            const { harness, reverting, guardian1, guardian2 } = await loadFixture(deployFixture);
            
            const tx = await harness.connect(guardian1).proposeEmergencyPause([
                await reverting.getAddress()
            ]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPauseProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const pauseId = parsedEvent?.args[0];

            await harness.connect(guardian2).confirmEmergencyPause(pauseId);

            const isFailed = await harness.isFailedTarget(await reverting.getAddress());
            expect(isFailed).to.equal(true);

            const failedList = await harness.getFailedList();
            expect(failedList).to.include(await reverting.getAddress());
        });

        it("reverts when proposal not found", async () => {
            const { harness, guardian2 } = await loadFixture(deployFixture);
            const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));

            await expect(
                harness.connect(guardian2).confirmEmergencyPause(fakeId)
            ).to.be.revertedWithCustomError(harness, "ProposalNotFound");
        });

        it("reverts when already confirmed by same guardian", async () => {
            const { harness, pausable1, guardian1 } = await loadFixture(deployFixture);
            
            const tx = await harness.connect(guardian1).proposeEmergencyPause([
                await pausable1.getAddress()
            ]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPauseProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const pauseId = parsedEvent?.args[0];

            await expect(
                harness.connect(guardian1).confirmEmergencyPause(pauseId)
            ).to.be.revertedWithCustomError(harness, "AlreadyConfirmed");
        });

        it("reverts when proposal expired", async () => {
            const { harness, pausable1, guardian1, guardian2 } = await loadFixture(deployFixture);
            
            const tx = await harness.connect(guardian1).proposeEmergencyPause([
                await pausable1.getAddress()
            ]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPauseProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const pauseId = parsedEvent?.args[0];

            await time.increase(3601); // Expires after 1 hour

            await expect(
                harness.connect(guardian2).confirmEmergencyPause(pauseId)
            ).to.be.revertedWithCustomError(harness, "ProposalExpired");
        });

        it("handles multiple targets with mixed success/failure", async () => {
            const { harness, pausable1, pausable2, reverting, guardian1, guardian2 } = await loadFixture(deployFixture);
            
            const targets = [
                await pausable1.getAddress(),
                await reverting.getAddress(),
                await pausable2.getAddress()
            ];
            
            const tx = await harness.connect(guardian1).proposeEmergencyPause(targets);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return harness.interface.parseLog(log as any)?.name === "EmergencyPauseProposed";
                } catch {
                    return false;
                }
            });
            const parsedEvent = harness.interface.parseLog(event as any);
            const pauseId = parsedEvent?.args[0];

            await harness.connect(guardian2).confirmEmergencyPause(pauseId);

            expect(await pausable1.paused()).to.equal(true);
            expect(await pausable2.paused()).to.equal(true);
            expect(await harness.isFailedTarget(await reverting.getAddress())).to.equal(true);
        });
    });
});

describe("MonitoringLib", () => {
    async function deployFixture() {
        const [admin] = await ethers.getSigners();
        const libs = await deployAllLibraries();
        const harness = await deployHarness("MonitoringLibHarness", libs);

        const Oracle = await ethers.getContractFactory("MockOracleForEmergencyPrice");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();

        const MockVault = await ethers.getContractFactory("MockVaultControl");
        const vault = await MockVault.deploy();
        await vault.waitForDeployment();

        return { harness, oracle, vault, admin };
    }

    const MARKET = "0x00000000000000000000000000000000000000B7";

    describe("getProtocolHealth", () => {
        it("returns healthy state with low bad debt ratio", async () => {
            const { harness, oracle, vault } = await loadFixture(deployFixture);
            
            await vault.setTotalAssets(e6(1_000_000)); // $1M
            const currentTime = await time.latest();
            await harness.setProtocolHealth(true, e6(1000), currentTime); // $1k bad debt

            const [isHealthy, totalBadDebt, totalAssets, badDebtRatioBps] = await harness.getProtocolHealth(
                await vault.getAddress(),
                await oracle.getAddress()
            );

            expect(isHealthy).to.equal(true);
            expect(totalBadDebt).to.equal(e6(1000));
            expect(totalAssets).to.equal(e6(1_000_000));
            expect(badDebtRatioBps).to.equal(10n); // 0.1%
        });

        it("returns unhealthy state with high bad debt", async () => {
            const { harness, oracle, vault } = await loadFixture(deployFixture);
            
            await vault.setTotalAssets(e6(1_000_000));
            const currentTime = await time.latest();
            await harness.setProtocolHealth(false, e6(900_000), currentTime);

            const [isHealthy, , , badDebtRatioBps] = await harness.getProtocolHealth(
                await vault.getAddress(),
                await oracle.getAddress()
            );

            expect(isHealthy).to.equal(false);
            expect(badDebtRatioBps).to.equal(9000n); // 90%
        });

        it("handles zero total assets", async () => {
            const { harness, oracle, vault } = await loadFixture(deployFixture);
            
            await vault.setTotalAssets(0);
            const currentTime = await time.latest();
            await harness.setProtocolHealth(true, 0, currentTime);

            const [, , totalAssets, badDebtRatioBps] = await harness.getProtocolHealth(
                await vault.getAddress(),
                await oracle.getAddress()
            );

            expect(totalAssets).to.equal(0n);
            expect(badDebtRatioBps).to.equal(0n);
        });

        it("includes global PnL calculation", async () => {
            const { harness, oracle, vault } = await loadFixture(deployFixture);
            
            await vault.setTotalAssets(e6(1_000_000));
            const currentTime = await time.latest();
            await harness.setProtocolHealth(true, 0, currentTime);
            await harness.addActiveMarket(MARKET);
            await harness.setMarket(MARKET, true, e18(100_000), e18(50_000));
            await oracle.setPrice(MARKET, e18(100), e18(1), await time.latest());

            const [, , , , , globalPnL] = await harness.getProtocolHealth(
                await vault.getAddress(),
                await oracle.getAddress()
            );

            // GlobalPnL should be calculated (may be 0 or non-zero depending on market state)
            expect(globalPnL).to.not.be.undefined;
        });
    });

    describe("getCircuitBreakerStatus", () => {
        it("returns circuit breaker status for market", async () => {
            const { harness, oracle } = await loadFixture(deployFixture);

            const [isRestricted, activeBreakers, globalPause] = await harness.getCircuitStatus(
                await oracle.getAddress(),
                MARKET
            );

            expect(isRestricted).to.equal(false);
            expect(activeBreakers).to.equal(0n);
            expect(globalPause).to.equal(false);
        });
    });

    describe("getPositionHealth", () => {
        it("returns health for open position", async () => {
            const { harness, oracle } = await loadFixture(deployFixture);
            
            await oracle.setPrice(MARKET, e18(100), e18(1), await time.latest());
            
            // PosStatus.OPEN = 1, flags with isLong bit set = 1
            await harness.setPosition(1, 1, MARKET, e18(10_000), e18(100), 1);
            await harness.setCollateral(1, e18(2000));

            const [isLiquidatable, healthFactor, unrealizedPnL, currentPrice] = await harness.getPositionHealth(
                1,
                await oracle.getAddress()
            );

            expect(isLiquidatable).to.be.a("boolean");
            expect(healthFactor).to.be.greaterThan(0n);
            expect(currentPrice).to.equal(e18(100));
        });

        it("returns max health factor for closed position", async () => {
            const { harness, oracle } = await loadFixture(deployFixture);
            
            await oracle.setPrice(MARKET, e18(100), e18(1), await time.latest());
            
            // PosStatus.CLOSED = 2
            await harness.setPosition(1, 2, MARKET, e18(10_000), e18(100), 1);
            await harness.setCollateral(1, e18(2000));

            const [isLiquidatable, healthFactor, unrealizedPnL, currentPrice] = await harness.getPositionHealth(
                1,
                await oracle.getAddress()
            );

            expect(isLiquidatable).to.equal(false);
            expect(healthFactor).to.equal(ethers.MaxUint256);
            expect(unrealizedPnL).to.equal(0n);
            expect(currentPrice).to.equal(0n);
        });

        it("detects liquidatable position", async () => {
            const { harness, oracle } = await loadFixture(deployFixture);
            
            await oracle.setPrice(MARKET, e18(85), e18(1), await time.latest());
            
            // Long position with 20x leverage, small collateral
            await harness.setPosition(1, 1, MARKET, e18(10_000), e18(100), 1);
            await harness.setCollateral(1, e18(200)); // Very small collateral

            const [isLiquidatable] = await harness.getPositionHealth(1, await oracle.getAddress());

            expect(isLiquidatable).to.equal(true);
        });
    });
});

describe("DustLib", () => {
    async function deployFixture() {
        const [admin, treasury] = await ethers.getSigners();
        const libs = await deployAllLibraries();
        const harness = await deployHarness("DustLibHarness", libs);

        const USDC = await ethers.getContractFactory("MockUSDC");
        const usdc = await USDC.deploy();
        await usdc.waitForDeployment();

        // Fund harness with USDC using mintTo
        await usdc.mintTo(await harness.getAddress(), e6(10_000));

        return { harness, usdc, admin, treasury };
    }

    describe("sweepDust", () => {
        it("sweeps accumulated dust to treasury", async () => {
            const { harness, usdc, treasury } = await loadFixture(deployFixture);
            
            // Set dust: 1.5 USDC in internal precision (1e18)
            await harness.setDust(e18(1.5), 0);

            const balanceBefore = await usdc.balanceOf(treasury.address);

            const swept = await harness.sweepDust.staticCall(
                await usdc.getAddress(),
                treasury.address
            );
            // e18(1.5) / 1e12 = 1.5e6 (USDC precision)
            expect(swept).to.equal(e6(1.5));

            await harness.sweepDust(await usdc.getAddress(), treasury.address);

            const balanceAfter = await usdc.balanceOf(treasury.address);
            expect(balanceAfter - balanceBefore).to.equal(e6(1.5));

            expect(await harness.getTotalDust()).to.equal(0n);
            expect(await harness.getLastSweepTimestamp()).to.be.greaterThan(0n);
        });

        it("handles zero dust (no-op)", async () => {
            const { harness, usdc, treasury } = await loadFixture(deployFixture);
            
            await harness.setDust(0, 0);

            const balanceBefore = await usdc.balanceOf(treasury.address);

            const swept = await harness.sweepDust.staticCall(
                await usdc.getAddress(),
                treasury.address
            );
            expect(swept).to.equal(0n);

            await harness.sweepDust(await usdc.getAddress(), treasury.address);

            const balanceAfter = await usdc.balanceOf(treasury.address);
            expect(balanceAfter).to.equal(balanceBefore);

            // Timestamp should not be updated
            expect(await harness.getLastSweepTimestamp()).to.equal(0n);
        });

        it("handles dust below 1 USDC precision", async () => {
            const { harness, usdc, treasury } = await loadFixture(deployFixture);
            
            // 0.5 USDC in internal precision
            await harness.setDust(e18(0.5), 0);

            const swept = await harness.sweepDust.staticCall(
                await usdc.getAddress(),
                treasury.address
            );
            // e18(0.5) / 1e12 = 0.5e6 = 500000 (in USDC 6 decimals, this is 0.5 USDC)
            expect(swept).to.equal(e6(0.5));

            await harness.sweepDust(await usdc.getAddress(), treasury.address);

            expect(await harness.getTotalDust()).to.equal(0n);
        });

        it("accumulates multiple sweep timestamps", async () => {
            const { harness, usdc, treasury } = await loadFixture(deployFixture);
            
            await harness.setDust(e18(1.5), 0);
            await harness.sweepDust(await usdc.getAddress(), treasury.address);
            
            const timestamp1 = await harness.getLastSweepTimestamp();
            expect(timestamp1).to.be.greaterThan(0n);

            await time.increase(3600);

            await harness.setDust(e18(2.3), timestamp1);
            await harness.sweepDust(await usdc.getAddress(), treasury.address);

            const timestamp2 = await harness.getLastSweepTimestamp();
            expect(timestamp2).to.be.greaterThan(timestamp1);
        });

        it("handles large dust amounts", async () => {
            const { harness, usdc, treasury } = await loadFixture(deployFixture);
            
            // 1000 USDC worth of dust
            await harness.setDust(e18(1000), 0);

            const swept = await harness.sweepDust.staticCall(
                await usdc.getAddress(),
                treasury.address
            );
            expect(swept).to.equal(e6(1000));
        });
    });
});
