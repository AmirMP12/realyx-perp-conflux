import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const MARKET = "0x00000000000000000000000000000000000000B7";

/**
 * Verifies PositionTriggersLib's `p.state != OPEN` guards in setTakeProfit and
 * setTrailingStop. These reverts fire before any external (oracle /
 * position-token) call, so dummy addresses suffice. The setStopLoss guard is
 * already covered through the integration suite.
 */
describe("PositionTriggersLib — state guards", () => {
    async function setup() {
        const [owner] = await ethers.getSigners();
        const libs = await deployAllLibraries();
        const h = await deployHarness("ExtraCoverageHarness", libs);
        // standalone lib instance carries the custom-error ABI the harness re-throws.
        const errLib = await (await ethers.getContractFactory("PositionTriggersLib")).deploy();
        await errLib.waitForDeployment();
        return { h, errLib, owner };
    }

    it("setTakeProfit reverts PositionNotFound for a non-open position", async () => {
        const { h, errLib, owner } = await loadFixture(setup);
        // CLOSED position -> state guard trips before the ownerOf / oracle calls.
        await h.setPosition(owner.address, 1, e18(10_000), e18(50_000), 1, PosStatus.CLOSED, MARKET);
        await expect(
            h.triggerSetTakeProfit(1, e18(60_000), ethers.ZeroAddress, ethers.ZeroAddress, 0),
        ).to.be.revertedWithCustomError(errLib, "PositionNotFound");
    });

    it("setTrailingStop reverts PositionNotFound for a non-open position (bps within bound)", async () => {
        const { h, errLib, owner } = await loadFixture(setup);
        await h.setPosition(owner.address, 2, e18(10_000), e18(50_000), 1, PosStatus.CLOSED, MARKET);
        // bps (100) <= maxTrailingBps (1000) so the trailing-bound guard passes,
        // then the state guard reverts.
        await expect(
            h.triggerSetTrailingStop(2, 100, 1000, ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(errLib, "PositionNotFound");
    });

    it("setTrailingStop reverts InvalidTrailingStop when bps exceeds the max", async () => {
        const { h, errLib, owner } = await loadFixture(setup);
        await h.setPosition(owner.address, 3, e18(10_000), e18(50_000), 1, PosStatus.OPEN, MARKET);
        await expect(
            h.triggerSetTrailingStop(3, 2000, 1000, ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(errLib, "InvalidTrailingStop");
    });
});
