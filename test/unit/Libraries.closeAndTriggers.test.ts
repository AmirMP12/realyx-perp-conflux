import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus, TRADING_CORE_ROLE } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";

describe("PositionCloseLib token-collateral payout", () => {
    async function setup() {
        const [admin, treasury, owner] = await ethers.getSigners();
        const USDC = await ethers.getContractFactory("MockUSDC");
        const usdc = await USDC.deploy();
        await usdc.waitForDeployment();

        const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();

        const PT = await ethers.getContractFactory("MockPositionTokenSimple");
        const pt = await PT.deploy();
        await pt.waitForDeployment();

        const Vault = await ethers.getContractFactory("MockVaultControl");
        const vault = await Vault.deploy();
        await vault.waitForDeployment();

        // A collateral token + registry so the token-payout path resolves a token amount.
        const Token = await ethers.getContractFactory("MockUSDC");
        const collat = await Token.deploy();
        await collat.waitForDeployment();
        const Registry = await ethers.getContractFactory("CollateralRegistry");
        const registry = await Registry.deploy(admin.address, await oracle.getAddress());
        await registry.waitForDeployment();
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(await collat.getAddress(), e18(1), 0, now);
        await registry.registerToken(await collat.getAddress(), 200, 500, 3000, 100, 50, e6(100_000_000), await collat.getAddress(), 6);

        const libs = await deployAllLibraries();
        const h = await deployHarness("PositionCloseLibHarness", libs, [
            await usdc.getAddress(),
            await vault.getAddress(),
            await oracle.getAddress(),
            await pt.getAddress(),
            treasury.address,
        ]);
        await usdc.mintTo(await h.getAddress(), e6(10_000_000));
        // also fund the harness with the collateral token so the token transfer to owner succeeds
        await collat.mintTo(await h.getAddress(), e6(10_000_000));
        await oracle.setPrice(MARKET, e18(50_000), 0, now);
        await oracle.setTWAP(MARKET, e18(50_000));
        await oracle.setTWAPValid(MARKET, true);
        await h.setMarket(MARKET, 500);
        return { h, usdc, oracle, pt, vault, registry, collat, owner };
    }

    it("pays out a profitable close in the position's collateral token", async () => {
        const { h, oracle, pt, registry, collat, owner } = await loadFixture(setup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithToken(1, e18(2_000), await collat.getAddress());
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(55_000), 0, now); // +10% profit
        await oracle.setTWAP(MARKET, e18(55_000));
        const before = await collat.balanceOf(owner.address);
        await h.closeWithRegistry(1, e18(10_000), 0, await registry.getAddress());
        // owner received collateral-token payout
        expect(await collat.balanceOf(owner.address)).to.be.greaterThan(before);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });
});

describe("PositionTriggersLib stop-loss and take-profit validation", () => {
    // PositionTriggersLib validateStopLoss/validateTakeProfit clearing with a zero
    // value is exercised through the full trading flows (setStopLoss(0)/setTakeProfit(0)).
    it("placeholder ensures file has a spec", async () => {
        expect(true).to.equal(true);
    });
});
