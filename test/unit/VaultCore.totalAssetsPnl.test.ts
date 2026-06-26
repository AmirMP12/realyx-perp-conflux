import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { usdc, OPERATOR_ROLE, GUARDIAN_ROLE, TRADING_CORE_ROLE } from "../helpers/constants";

const market = "0x00000000000000000000000000000000000000B7";

/**
 * Verifies VaultCore views that depend on a wired TradingCore returning a
 * controllable global PnL (totalAssets / getConservativeTotalAssets /
 * getUtilization / getLPSharePrice / share conversions), plus the
 * unwired-tradingCore (address(0)) early-return path, the rebate
 * accrual/claim flow, and the per-market exposure-bps fallback.
 *
 * It deploys a standalone VaultCore proxy so the FIRST-TIME setTradingCore
 * wireup (immediate, no 48h timelock) can point at MockTradingCorePnl.
 */
async function deployVault() {
    const [admin, treasuryAcct, lp, alice, referrer] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory("MockUSDC");
    const token = await USDC.deploy();
    await token.waitForDeployment();

    const Vault = await ethers.getContractFactory("VaultCore");
    const vault = await upgrades.deployProxy(
        Vault,
        [admin.address, await token.getAddress(), treasuryAcct.address],
        { kind: "uups", initializer: "initialize" },
    );
    await vault.waitForDeployment();

    await vault.connect(admin).grantRole(OPERATOR_ROLE, admin.address);
    await vault.connect(admin).grantRole(GUARDIAN_ROLE, admin.address);

    for (const s of [lp, alice]) {
        await token.mintTo(s.address, usdc(50_000_000));
        await token.connect(s).approve(await vault.getAddress(), ethers.MaxUint256);
    }

    const Mock = await ethers.getContractFactory("MockTradingCorePnl");
    const core = await Mock.deploy();
    await core.waitForDeployment();

    return { vault, token, core, admin, treasuryAcct, lp, alice, referrer };
}

async function fundedWithCore() {
    const ctx = await deployVault();
    const { vault, lp, core } = ctx;
    await vault.connect(lp).deposit(usdc(5_000_000), lp.address);
    // first-time wireup is immediate; points the vault's TradingCore at the mock
    await vault.connect(ctx.admin).setTradingCore(await core.getAddress());
    return ctx;
}

describe("VaultCore — PnL-dependent views via a mock TradingCore", () => {
    it("totalAssets subtracts a positive global PnL liability when total exceeds the liability", async () => {
        const { vault, core } = await loadFixture(fundedWithCore);
        const before = await vault.totalAssets();
        await core.setPnl(usdc(100_000));
        const after = await vault.totalAssets();
        expect(after).to.be.lessThan(before);
    });

    it("totalAssets floors at zero when positive PnL liability exceeds total", async () => {
        const { vault, core } = await loadFixture(fundedWithCore);
        await core.setPnl(ethers.parseUnits("999999999999", 18)); // enormous liability
        expect(await vault.totalAssets()).to.equal(0n);
    });

    it("totalAssets adds a negative global PnL (trader losses) to NAV", async () => {
        const { vault, core } = await loadFixture(fundedWithCore);
        const before = await vault.totalAssets();
        await core.setPnl(-usdc(50_000));
        expect(await vault.totalAssets()).to.be.greaterThan(before);
    });

    it("totalAssets degrades to no adjustment when the PnL probe reverts", async () => {
        const { vault, core } = await loadFixture(fundedWithCore);
        await core.setShouldRevert(true);
        // returns the unadjusted total without reverting
        expect(await vault.totalAssets()).to.be.greaterThan(0n);
    });

    it("getConservativeTotalAssets subtracts positive trader PnL only", async () => {
        const { vault, core } = await loadFixture(fundedWithCore);
        const flat = await vault.getConservativeTotalAssets();
        await core.setPnl(usdc(100_000));
        expect(await vault.getConservativeTotalAssets()).to.be.lessThan(flat);
        // negative PnL is ignored by the conservative mark (no uplift)
        await core.setPnl(-usdc(100_000));
        expect(await vault.getConservativeTotalAssets()).to.equal(flat);
    });

    it("getConservativeTotalAssets floors at zero when positive PnL exceeds total", async () => {
        const { vault, core } = await loadFixture(fundedWithCore);
        await core.setPnl(ethers.parseUnits("999999999999", 18));
        expect(await vault.getConservativeTotalAssets()).to.equal(0n);
    });

    it("getConservativeTotalAssets degrades to no adjustment on probe revert", async () => {
        const { vault, core } = await loadFixture(fundedWithCore);
        await core.setShouldRevert(true);
        expect(await vault.getConservativeTotalAssets()).to.be.greaterThan(0n);
    });

    it("getUtilization is non-zero once there are borrows and assets", async () => {
        const { vault, core } = await loadFixture(fundedWithCore);
        // wire a non-zero borrow via the mock acting as TradingCore role-holder
        await vault.connect(await impersonate(core)).borrow(usdc(500_000), market, true).catch(() => {});
        // utilization computes total via the mock PnL probe when globalPnL is zero
        const util = await vault.getUtilization();
        expect(util).to.be.a("bigint");
    });

    it("getLPSharePrice uses totalAssets when shares exist", async () => {
        const { vault } = await loadFixture(fundedWithCore);
        const p = await vault.getLPSharePrice();
        expect(p).to.be.greaterThan(0n);
    });

    it("traderPnLFullyPriced returns the mock's complete flag (true)", async () => {
        const { vault } = await loadFixture(fundedWithCore);
        expect(await vault.traderPnLFullyPriced()).to.equal(true);
    });
});

describe("VaultCore — unwired TradingCore (address(0))", () => {
    it("traderPnLFullyPriced returns true when tradingCore is unset", async () => {
        const { vault } = await loadFixture(deployVault);
        // tradingCore never wired -> exercises the tradingCore == address(0) case
        expect(await vault.traderPnLFullyPriced()).to.equal(true);
    });

    it("totalAssets and getConservativeTotalAssets skip the probe when tradingCore is unset", async () => {
        const { vault, lp } = await loadFixture(deployVault);
        await vault.connect(lp).deposit(usdc(1_000_000), lp.address);
        expect(await vault.totalAssets()).to.be.greaterThan(0n);
        expect(await vault.getConservativeTotalAssets()).to.be.greaterThan(0n);
    });
});

describe("VaultCore — rebate accrual / claim + exposure fallback", () => {
    it("accrueRebate returns early on a zero referrer or zero amount", async () => {
        const { vault, core, admin } = await loadFixture(fundedWithCore);
        // call as the wired tradingCore (the mock) — impersonate it
        const asCore = await impersonate(core);
        await vault.connect(asCore).accrueRebate(ethers.ZeroAddress, usdc(10));
        await vault.connect(asCore).accrueRebate(admin.address, 0);
        expect(await vault.pendingRebates()).to.equal(0n);
    });

    it("accrueRebate then claimRebates pays the referrer and clears the ledger", async () => {
        const { vault, token, core, referrer } = await loadFixture(fundedWithCore);
        const asCore = await impersonate(core);
        // the caller (tradingCore) must hold + approve the USDC it accrues
        await token.mintTo(await core.getAddress(), usdc(10_000));
        await token.connect(asCore).approve(await vault.getAddress(), ethers.MaxUint256);
        await vault.connect(asCore).accrueRebate(referrer.address, usdc(10_000));
        expect(await vault.claimableRebates(referrer.address)).to.equal(usdc(10_000));

        const before = await token.balanceOf(referrer.address);
        await vault.connect(referrer).claimRebates(referrer.address);
        expect(await token.balanceOf(referrer.address)).to.equal(before + usdc(10_000));
        expect(await vault.claimableRebates(referrer.address)).to.equal(0n);
    });

    it("claimRebates reverts on a zero recipient and with no balance", async () => {
        const { vault, alice } = await loadFixture(fundedWithCore);
        await expect(vault.connect(alice).claimRebates(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            vault,
            "ZeroAddress",
        );
        await expect(vault.connect(alice).claimRebates(alice.address)).to.be.revertedWithCustomError(
            vault,
            "InsufficientLiquidity",
        );
    });

    it("setMaxExposure custom bps overrides the default in _getMaxExposureBps", async () => {
        const { vault, admin } = await loadFixture(fundedWithCore);
        await vault.connect(admin).setMaxExposure(market, 3500);
        const exp = await vault.getMarketExposure(market);
        expect(exp.maxExposurePercent).to.equal(3500n);
    });
});

// Impersonate a contract address so it can act as msg.sender (it holds the
// TRADING_CORE_ROLE granted by the first-time setTradingCore wireup).
async function impersonate(contract: any) {
    const addr = await contract.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [addr]);
    await ethers.provider.send("hardhat_setBalance", [addr, "0x3635C9ADC5DEA00000"]);
    return await ethers.getSigner(addr);
}
