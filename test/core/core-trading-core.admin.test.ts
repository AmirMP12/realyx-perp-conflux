import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("TradingCore - Admin & Configuration", function () {
    let env: any;
    const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));

    beforeEach(async () => {
        env = await deployTestEnvironment();
        // Grant admin the GUARDIAN_ROLE for pause testing
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
    });

    it("should allow admin to update global protocol parameters (setParams with 7 args)", async function () {
        // setParams(mps, mou, mab, mef, mpp, mid, ldb)
        await env.trading.connect(env.admin).setParams(
            ethers.parseUnits("1", 18),  // mps
            100,                          // mou 
            ethers.parseUnits("1", 18),  // mab
            ethers.parseUnits("1", 16),  // mef 
            5,                            // mpp (maxPositionsPerUser)
            100,                          // mid (minInteractionDelay)
            100                           // ldb (liquidationDeviationBps)
        );
    });

    it("should revert if a non-admin tries to update global parameters", async function () {
        await expect(
            env.trading.connect(env.alice).setParams(
                ethers.parseUnits("1", 18), 100, ethers.parseUnits("1", 18),
                ethers.parseUnits("1", 16), 5, 100, 100
            )
        ).to.be.reverted;
    });

    it("should handle pausing and unpausing via oracle global pause", async function () {
        await env.oracle.connect(env.admin).activateGlobalPause();
        expect(await env.oracle.isGloballyPaused()).to.be.true;

        await env.oracle.connect(env.admin).deactivateGlobalPause();
        expect(await env.oracle.isGloballyPaused()).to.be.false;
    });
});
