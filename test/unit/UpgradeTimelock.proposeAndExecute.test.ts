import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Exercises the `_authorizeUpgrade` staged-timelock bodies of the UUPS
 * contracts by performing a real upgradeToAndCall through the propose →
 * wait → upgrade flow, including the revert paths.
 */

const TL = 48 * 60 * 60 + 1;

describe("UUPS upgrade timelock — _authorizeUpgrade bodies", () => {
    it("DividendManager: mismatch revert, timelock revert, then success", async () => {
        const [admin] = await ethers.getSigners();
        const F = await ethers.getContractFactory("DividendManager");
        const p = await upgrades.deployProxy(F, [admin.address], { kind: "uups", initializer: "initialize" });
        await p.waitForDeployment();
        const impl = await F.deploy();
        await impl.waitForDeployment();
        const addr = await impl.getAddress();
        await expect(p.upgradeToAndCall(addr, "0x")).to.be.revertedWithCustomError(
            p,
            "PendingImplementationMismatch",
        );
        await p.proposeImplementation(addr);
        await expect(p.upgradeToAndCall(addr, "0x")).to.be.revertedWithCustomError(p, "UpgradeTimelockActive");
        await time.increase(TL);
        await p.upgradeToAndCall(addr, "0x");
        const [pending] = await p.pendingImplementation();
        expect(pending).to.equal(ethers.ZeroAddress);
    });

    it("MarketCalendar: propose, wait, upgrade", async () => {
        const [admin] = await ethers.getSigners();
        const F = await ethers.getContractFactory("MarketCalendar");
        const p = await upgrades.deployProxy(F, [admin.address], { kind: "uups", initializer: "initialize" });
        await p.waitForDeployment();
        const impl = await F.deploy();
        await impl.waitForDeployment();
        const addr = await impl.getAddress();
        await p.proposeImplementation(addr);
        await time.increase(TL);
        await p.upgradeToAndCall(addr, "0x");
        const [pending] = await p.pendingImplementation();
        expect(pending).to.equal(ethers.ZeroAddress);
    });

    it("PositionToken: propose, wait, upgrade", async () => {
        const F = await ethers.getContractFactory("PositionToken");
        const p = await upgrades.deployProxy(F, ["RWA", "RWAP", "https://m/"], {
            kind: "uups",
            initializer: "initialize",
            unsafeAllow: ["constructor"],
        });
        await p.waitForDeployment();
        const impl = await F.deploy();
        await impl.waitForDeployment();
        const addr = await impl.getAddress();
        await expect(p.upgradeToAndCall(addr, "0x")).to.be.revertedWithCustomError(
            p,
            "PendingImplementationMismatch",
        );
        await p.proposeImplementation(addr);
        await expect(p.upgradeToAndCall(addr, "0x")).to.be.revertedWithCustomError(p, "UpgradeTimelockActive");
        await time.increase(TL);
        await p.upgradeToAndCall(addr, "0x");
        const [pending] = await p.pendingImplementation();
        expect(pending).to.equal(ethers.ZeroAddress);
    });

    it("ReferralRegistry: propose, wait, upgrade", async () => {
        const [admin] = await ethers.getSigners();
        const F = await ethers.getContractFactory("ReferralRegistry");
        const p = await upgrades.deployProxy(F, [admin.address, 100, 50], {
            kind: "uups",
            initializer: "initialize",
        });
        await p.waitForDeployment();
        const impl = await F.deploy();
        await impl.waitForDeployment();
        const addr = await impl.getAddress();
        await p.proposeImplementation(addr);
        await time.increase(TL);
        await p.upgradeToAndCall(addr, "0x");
        const [pending] = await p.pendingImplementation();
        expect(pending).to.equal(ethers.ZeroAddress);
    });

    it("OracleAggregator: propose, wait, upgrade", async () => {
        const [admin] = await ethers.getSigners();
        const MockPyth = await ethers.getContractFactory("MockPythWrapper");
        const pyth = await MockPyth.deploy(3600, 1);
        await pyth.waitForDeployment();
        const F = await ethers.getContractFactory("OracleAggregator");
        const p = await upgrades.deployProxy(F, [admin.address, await pyth.getAddress()], {
            kind: "uups",
            initializer: "initialize",
        });
        await p.waitForDeployment();
        const impl = await F.deploy();
        await impl.waitForDeployment();
        const addr = await impl.getAddress();
        await expect(p.upgradeToAndCall(addr, "0x")).to.be.revertedWithCustomError(
            p,
            "PendingImplementationMismatch",
        );
        await p.proposeImplementation(addr);
        await time.increase(TL);
        await p.upgradeToAndCall(addr, "0x");
        const [pending] = await p.pendingImplementation();
        expect(pending).to.equal(ethers.ZeroAddress);
    });

    it("VaultCore: propose, wait, upgrade", async () => {
        const [admin, treasury] = await ethers.getSigners();
        const USDC = await ethers.getContractFactory("MockUSDT0");
        const usdc = await USDC.deploy();
        await usdc.waitForDeployment();
        const F = await ethers.getContractFactory("VaultCore");
        const p = await upgrades.deployProxy(F, [admin.address, await usdc.getAddress(), treasury.address], {
            kind: "uups",
            initializer: "initialize",
        });
        await p.waitForDeployment();
        const impl = await F.deploy();
        await impl.waitForDeployment();
        const addr = await impl.getAddress();
        await p.proposeImplementation(addr);
        await time.increase(TL);
        await p.upgradeToAndCall(addr, "0x");
        const [pending] = await p.pendingImplementation();
        expect(pending).to.equal(ethers.ZeroAddress);
    });

    it("TradingCore: propose, wait, upgrade (linked libraries)", async () => {
        const { deployProtocol } = await import("../helpers/fixture");
        const d = await deployProtocol();
        // deploy a fresh TradingCore implementation with the same linked libraries
        const libKey = (name: string) => `contracts/libraries/${name}.sol:${name}`;
        const deployLib = async (name: string, libs?: Record<string, string>) => {
            const f = libs
                ? await ethers.getContractFactory(name, { libraries: libs })
                : await ethers.getContractFactory(name);
            const c = await f.deploy();
            await c.waitForDeployment();
            return c.getAddress();
        };
        const dividendSettlementLib = await deployLib("DividendSettlementLib");
        const fundingLib = await deployLib("FundingLib");
        const liquidationLib = await deployLib("LiquidationLib");
        const positionCloseLib = await deployLib("PositionCloseLib");
        const tradingLib = await deployLib("TradingLib", {
            [libKey("DividendSettlementLib")]: dividendSettlementLib,
            [libKey("FundingLib")]: fundingLib,
            [libKey("LiquidationLib")]: liquidationLib,
            [libKey("PositionCloseLib")]: positionCloseLib,
        });
        const libs: Record<string, string> = {
            [libKey("CleanupLib")]: await deployLib("CleanupLib"),
            [libKey("ConfigLib")]: await deployLib("ConfigLib"),
            [libKey("DustLib")]: await deployLib("DustLib"),
            [libKey("FlashLoanCheck")]: await deployLib("FlashLoanCheck"),
            [libKey("FundingLib")]: fundingLib,
            [libKey("HealthLib")]: await deployLib("HealthLib"),
            [libKey("PositionTriggersLib")]: await deployLib("PositionTriggersLib"),
            [libKey("RateLimitLib")]: await deployLib("RateLimitLib"),
            [libKey("TradingContextLib")]: await deployLib("TradingContextLib"),
            [libKey("TradingLib")]: tradingLib,
            [libKey("WithdrawLib")]: await deployLib("WithdrawLib"),
        };
        const F = await ethers.getContractFactory("TradingCore", { libraries: libs });
        const impl = await F.deploy();
        await impl.waitForDeployment();
        const addr = await impl.getAddress();
        await d.tradingCore.connect(d.admin).proposeImplementation(addr);
        await time.increase(TL);
        await d.tradingCore.connect(d.admin).upgradeToAndCall(addr, "0x");
        const [pending] = await d.tradingCore.pendingImplementation();
        expect(pending).to.equal(ethers.ZeroAddress);
    });
});
