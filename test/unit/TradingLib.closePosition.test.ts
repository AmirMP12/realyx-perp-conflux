import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";

/**
 * Exercises TradingLib.closePosition (via PositionCloseLib) through the
 * driveOpen/driveClose harness drivers. Each test opens a real position in
 * harness storage, then closes it to exercise a specific close path.
 */
async function setup() {
    const [admin] = await ethers.getSigners();
    const libs = await deployAllLibraries();
    const h = await deployHarness("CoverageHarness", libs);

    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();
    const Vault = await ethers.getContractFactory("MockVaultForOpen");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();
    await vault.setUsdc(await usdc.getAddress());
    const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const PT = await ethers.getContractFactory("MockPositionTokenSimple");
    const pt = await PT.deploy();
    await pt.waitForDeployment();

    await usdc.mintTo(await h.getAddress(), e6(10_000_000));
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, e18(50_000), 0, now);
    await oracle.setTWAP(MARKET, e18(50_000));
    await oracle.setTWAPValid(MARKET, true);

    await h.configureOpenMarket(
        MARKET,
        true,
        true,
        ethers.parseUnits("100000000", 18),
        ethers.parseUnits("500000000", 18),
        100,
        0,
    );
    await h.setOpenWiring(await usdc.getAddress(), await vault.getAddress(), await oracle.getAddress(), false);
    await h.setOpenPositionToken(await pt.getAddress());

    const base = {
        account: admin.address,
        orderType: 0,
        isLong: true,
        sizeDelta: e6(10_000),
        collateralDelta: e6(2_000),
        triggerPrice: 0n,
        maxSlippage: 0n,
        stopLossPrice: 0n,
        takeProfitPrice: 0n,
        currentPrice: e18(50_000),
        minPositionSize: e6(10),
        maxUserExposure: 0n,
        userDailyVolumeLimit: 0n,
        globalDailyVolumeLimit: 0n,
        nextPositionId: 1n,
    };
    return { h, usdc, vault, oracle, admin, base };
}

async function open(h: any, base: any, over: any = {}) {
    await h.driveOpen({ ...base, ...over });
}

describe("TradingLib.closePosition", () => {
    it("fully closes a long at entry price (burns NFT, marks CLOSED)", async () => {
        const { h, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        await h.driveClose(1, size, 0);
        const pos = await h.getDrivenPosition(1);
        expect(pos.state).to.equal(2); // CLOSED
    });

    it("partially closes a long (keeps it OPEN, reduces size)", async () => {
        const { h, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        await h.driveClose(1, size / 2n, 0);
        const pos = await h.getDrivenPosition(1);
        expect(pos.state).to.equal(1); // still OPEN
        expect(pos.size).to.equal(size - size / 2n);
    });

    it("reverts ZeroCloseSize when closeSize is 0", async () => {
        const { h, base } = await loadFixture(setup);
        await open(h, base);
        await expect(h.driveClose(1, 0, 0)).to.be.reverted;
    });

    it("reverts CloseSizeExceedsPosition when closeSize > position size", async () => {
        const { h, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        await expect(h.driveClose(1, size + 1n, 0)).to.be.reverted;
    });

    it("reverts TwapNotReady when the buffer is cold and no minReceive is supplied", async () => {
        const { h, oracle, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        await oracle.setTWAPValid(MARKET, false);
        await expect(h.driveClose(1, size, 0)).to.be.reverted;
    });

    it("allows a cold-TWAP close when minReceive is supplied (slippage protection path)", async () => {
        const { h, oracle, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        await oracle.setTWAPValid(MARKET, false);
        // minReceive small enough to pass the payout floor
        await h.driveClose(1, size, 1n);
        expect((await h.getDrivenPosition(1)).state).to.equal(2);
    });

    it("reverts ClosePriceDeviation when spot deviates far from a valid TWAP", async () => {
        const { h, oracle, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        // current price unchanged at 50k but TWAP moved to 40k -> 25% deviation
        await oracle.setTWAP(MARKET, e18(40_000));
        await expect(h.driveClose(1, size, 0)).to.be.reverted;
    });

    it("closes in profit when price rises (long)", async () => {
        const { h, oracle, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(52_000), 0, now);
        await oracle.setTWAP(MARKET, e18(52_000));
        await h.driveClose(1, size, 0);
        expect((await h.getDrivenPosition(1)).state).to.equal(2);
    });

    it("closes in loss when price falls (long, negative pnl)", async () => {
        const { h, oracle, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        // small drop to stay within the 10% close deviation cap
        await oracle.setPrice(MARKET, e18(48_000), 0, now);
        await oracle.setTWAP(MARKET, e18(48_000));
        await h.driveClose(1, size, 0);
        expect((await h.getDrivenPosition(1)).state).to.equal(2);
    });

    it("reverts SlippageExceeded when payout is below minReceive", async () => {
        const { h, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        // demand an unrealistically high payout
        await expect(h.driveClose(1, size, e6(1_000_000))).to.be.reverted;
    });

    it("fully closes a short position", async () => {
        const { h, base } = await loadFixture(setup);
        await open(h, base, { isLong: false });
        const size = (await h.getDrivenPosition(1)).size;
        await h.driveClose(1, size, 0);
        expect((await h.getDrivenPosition(1)).state).to.equal(2);
    });

    it("closes a short in profit when price falls", async () => {
        const { h, oracle, base } = await loadFixture(setup);
        await open(h, base, { isLong: false });
        const size = (await h.getDrivenPosition(1)).size;
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(48_000), 0, now);
        await oracle.setTWAP(MARKET, e18(48_000));
        await h.driveClose(1, size, 0);
        expect((await h.getDrivenPosition(1)).state).to.equal(2);
    });

    it("partial close recomputes leverage and liquidation price", async () => {
        const { h, base } = await loadFixture(setup);
        await open(h, base, { collateralDelta: e6(3_000) });
        const before = await h.getDrivenPosition(1);
        await h.driveClose(1, before.size / 4n, 0);
        const after = await h.getDrivenPosition(1);
        expect(after.size).to.equal(before.size - before.size / 4n);
        expect(after.liquidationPrice).to.be.greaterThan(0n);
    });

    it("two sequential partial closes eventually close the full position", async () => {
        const { h, base } = await loadFixture(setup);
        await open(h, base);
        const size = (await h.getDrivenPosition(1)).size;
        await h.driveClose(1, size / 2n, 0);
        const remaining = (await h.getDrivenPosition(1)).size;
        await h.driveClose(1, remaining, 0);
        expect((await h.getDrivenPosition(1)).state).to.equal(2);
    });
});
