import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("VaultCore Branch Wave", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        return { env };
    }

    it("covers updateProtocolTVL and threshold/admin branches", async function () {
        const { env } = await loadFixture(fixture);
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);

        await env.vault.connect(env.admin).setMaxProtocolTVL(1_000_000n);
        await expect(env.vault.connect(env.admin).updateProtocolTVL(1_000_001n)).to.be.reverted;
        await env.vault.connect(env.admin).updateProtocolTVL(999_999n);

        await env.vault.connect(env.admin).setThresholds(7000, 9000);
        await env.vault.connect(env.admin).resetInsuranceCircuitBreaker();
        await env.vault.connect(env.admin).setMaxExposure(ethers.Wallet.createRandom().address, 2500);
    });

    it("covers emergency mode stop paths and maxRedeem emergency branch", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));

        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        // No-op stop path when not in emergency mode
        await env.vault.connect(env.admin).stopEmergencyMode();

        // Enter emergency mode
        await env.vault.connect(env.admin).setThresholds(0, 9000);
        await env.vault.connect(env.admin).triggerEmergencyMode();
        expect(await env.vault.maxRedeem(env.admin.address)).to.equal(0n);

        // With zero restriction threshold, stopEmergencyMode cannot deactivate.
        await env.vault.connect(env.admin).stopEmergencyMode();
        expect(await env.vault.isEmergencyMode()).to.equal(true);

        // Raise threshold to allow deactivation path.
        await env.vault.connect(env.admin).setThresholds(7000, 9000);
        await env.vault.connect(env.admin).stopEmergencyMode();
        expect(await env.vault.isEmergencyMode()).to.equal(false);
    });

    it("covers emergency escape guard branches", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await expect(env.vault.connect(env.admin).emergencyEscapeWithdraw(1n)).to.be.reverted;

        await env.usdc.mintTo(env.admin.address, 2_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1_000_000_000n, env.admin.address);
        await env.vault.connect(env.admin).triggerEmergencyMode();

        await expect(env.vault.connect(env.admin).emergencyEscapeWithdraw(1n)).to.be.reverted;
        await time.increase(7 * 24 * 3600 + 5);
        await expect(env.vault.connect(env.admin).emergencyEscapeWithdraw(0n)).to.be.reverted;
    });

    it("covers deposit/withdraw guard branches and owner checks", async function () {
        const { env } = await loadFixture(fixture);

        await expect(env.vault.connect(env.admin).deposit(0n, env.admin.address)).to.be.reverted;
        await expect(env.vault.connect(env.admin).deposit(1_000_000n, ethers.ZeroAddress)).to.be.reverted;

        await env.usdc.mintTo(env.admin.address, 2_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1_000_000_000n, env.admin.address);

        await expect(env.vault.connect(env.admin).withdraw(0n, env.admin.address, env.admin.address)).to.be.reverted;
        await expect(env.vault.connect(env.admin).withdraw(1n, ethers.ZeroAddress, env.admin.address)).to.be.reverted;
        await expect(env.vault.connect(env.admin).withdraw(1n, env.admin.address, env.bob.address)).to.be.reverted;
    });

    it("covers withdraw success path (lpAssets update + transfer + event)", async function () {
        const { env } = await loadFixture(fixture);

        await env.usdc.mintTo(env.admin.address, 2_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1_000_000_000n, env.admin.address);

        const bal = await env.vault.lpBalanceOf(env.admin.address);
        const shares = bal / 10n;
        await env.vault.connect(env.admin).withdraw(shares, env.admin.address, env.admin.address);
    });

    it("covers insurance unstake cooldown and zero/receiver guards", async function () {
        const { env } = await loadFixture(fixture);

        await expect(env.vault.connect(env.admin).stakeInsurance(0n, env.admin.address)).to.be.reverted;
        await expect(env.vault.connect(env.admin).stakeInsurance(1_000_000n, ethers.ZeroAddress)).to.be.reverted;

        await env.usdc.mintTo(env.admin.address, 3_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(1_000_000_000n, env.admin.address);

        await expect(env.vault.connect(env.admin).unstakeInsurance(0n, env.admin.address)).to.be.reverted;
        await expect(env.vault.connect(env.admin).unstakeInsurance(1n, ethers.ZeroAddress)).to.be.reverted;
        await expect(env.vault.connect(env.admin).unstakeInsurance(1n, env.admin.address)).to.be.reverted;

        await env.vault.connect(env.admin).requestUnstake();
        await expect(env.vault.connect(env.admin).unstakeInsurance(1n, env.admin.address)).to.be.reverted;
    });

    it("covers claim and fee/surplus/treasury early-return branches", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));

        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await expect(env.vault.connect(env.admin).approveClaim(999n)).to.be.reverted;
        await expect(env.vault.connect(env.admin).processClaim(999n)).to.be.reverted;

        // receiveFees zero-return and distributeSurplus early-return paths
        await env.vault.connect(env.admin).receiveFees(0n);
        await env.vault.connect(env.admin).distributeSurplus();

        await expect(env.vault.connect(env.admin).setTreasury(ethers.ZeroAddress)).to.be.reverted;
        await env.vault.connect(env.admin).setTreasury(env.bob.address);
    });

    it("covers setTradingCore and withdrawal queue batch guards", async function () {
        const { env } = await loadFixture(fixture);

        await expect(env.vault.connect(env.admin).setTradingCore(ethers.ZeroAddress)).to.be.reverted;
        await env.vault.connect(env.admin).setTradingCore(env.alice.address);
        await env.vault.connect(env.admin).setTradingCore(env.bob.address);

        await expect(env.vault.connect(env.admin).queueWithdrawal(0n, 0n)).to.be.reverted;
        await expect(env.vault.connect(env.admin).queueWithdrawal(1n, 0n)).to.be.reverted;

        const ids = Array.from({ length: 60 }, (_, i) => BigInt(i + 1));
        await expect(env.vault.connect(env.admin).processWithdrawals(ids)).to.be.reverted;
    });

    it("covers coverBadDebt circuit breaker and large-claim submit branches", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();

        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 200_000e6);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(50_000e6, env.admin.address);

        await env.vault.connect(env.admin).resetInsuranceCircuitBreaker();

        // Large claim path goes through _submitClaimInternal and returns 0.
        const approvalThreshold = await env.vault.approvalThreshold();
        const covered = await env.vault.connect(env.admin).coverBadDebt.staticCall(approvalThreshold + 1n, 42n);
        expect(covered).to.equal(0n);
        await env.vault.connect(env.admin).coverBadDebt(approvalThreshold + 1n, 42n);

        // Trip circuit: cumulativeBadDebt24h + covered exceeds 10% of current _insAssets (50k → 5k).
        await env.vault.connect(env.admin).coverBadDebt(5020e6, 44n);
        expect(await env.vault.insuranceCircuitBreakerActive()).to.be.true;

        await expect(
            env.vault.connect(env.admin).coverBadDebt(1n, 45n)
        ).to.be.revertedWithCustomError(env.vault, "InsuranceFundCircuitBreakerActive");
    });

    it("covers borrow/repay/updateExposure branches", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);

        // borrow false path when liquidity/exposure constraints fail (empty vault)
        expect(await env.vault.connect(env.admin).borrow.staticCall(1_000_000n, env.alice.address, true)).to.equal(false);

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        // updateExposure decrement branch and cap check branch
        await env.vault.connect(env.admin).setMaxExposure(env.alice.address, 100);
        await env.vault.connect(env.admin).updateExposure(env.alice.address, 30_000_000n, true);
        await env.vault.connect(env.admin).updateExposure(env.alice.address, -1n, true);
        await env.vault.connect(env.admin).updateExposure(env.alice.address, -1n, false);

        // repay guard: insufficient repay balance
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.bob.address);
        await expect(env.vault.connect(env.bob).repay(1_000_000n, env.alice.address, true, 0n)).to.be.reverted;
    });

    it("covers distributeSurplus and withdraw emergency branch", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 8_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);
        await env.vault.connect(env.admin).stakeInsurance(2_000_000_000n, env.admin.address);
        await env.vault.connect(env.admin).setMaxProtocolTVL(1_000_000_000_000n);
        await env.vault.connect(env.admin).updateProtocolTVL(1_000_000_000n);
        await env.vault.connect(env.admin).receiveFees(500_000_000n);

        // exercises surplus distribution with treasury share and fee cap logic
        await env.vault.connect(env.admin).distributeSurplus();

        // emergency withdraw branch in withdraw()
        await env.vault.connect(env.admin).triggerEmergencyMode();
        await expect(env.vault.connect(env.admin).withdraw(1n, env.admin.address, env.admin.address)).to.be.reverted;
    });

    it("covers convertToShares rawTotal < minInitialDeposit branch", async function () {
        const { env } = await loadFixture(fixture);
        await env.usdc.mintTo(await env.vault.getAddress(), 1n);
        const shares = await env.vault.convertToShares(1_000_000n);
        expect(shares).to.be.gt(0n);
    });

    it("covers deposit first-deposit guards (InvalidFirstDeposit / MinimumDepositRequired)", async function () {
        const { env } = await loadFixture(fixture);

        await env.usdc.mintTo(env.admin.address, 2_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);

        // Make rawTotal > 0 before first deposit
        await env.usdc.mintTo(await env.vault.getAddress(), 1n);
        await expect(env.vault.connect(env.admin).deposit(1_000_000n, env.admin.address)).to.be.reverted;

        // Fresh vault instance: rawTotal == 0 but assets < minInitialDeposit
        const env2 = await deployTestEnvironment();
        await env2.usdc.mintTo(env2.admin.address, 2_000_000_000n);
        await env2.usdc.connect(env2.admin).approve(await env2.vault.getAddress(), ethers.MaxUint256);
        await expect(env2.vault.connect(env2.admin).deposit(1n, env2.admin.address)).to.be.reverted;
    });

    it("covers _convertToLPShares dead-shares formula when totalAssets is zeroed by PnL", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();
        const vaultAddr = await env.vault.getAddress();

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());

        const strayUsdc = 500n * 10n ** 6n;
        await env.usdc.mintTo(vaultAddr, strayUsdc);

        const internalTotal = strayUsdc * 10n ** 12n;
        await mockPnl.setPnl(internalTotal);

        expect(await env.vault.totalAssets()).to.equal(0n);
        expect(await env.vault.lpTotalShares()).to.equal(10n ** 7n);

        const assets = 2_000n * 10n ** 6n;
        const minInitialDeposit = await env.vault.minInitialDeposit();
        const deadShares = 10n * 10n ** 6n;
        const expected = (assets * deadShares) / minInitialDeposit;

        expect(await env.vault.convertToShares(assets)).to.equal(expected);
        expect(await env.vault.previewDeposit(assets)).to.equal(expected);
    });

    it("covers _convertToLPShares dead-shares / rawTotal when rawTotal >= minInitialDeposit", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();
        const vaultAddr = await env.vault.getAddress();

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());

        const strayUsdc = 1_500n * 10n ** 6n;
        await env.usdc.mintTo(vaultAddr, strayUsdc);
        await mockPnl.setPnl(strayUsdc * 10n ** 12n);

        expect(await env.vault.totalAssets()).to.equal(0n);

        const deadShares = 10n * 10n ** 6n;
        const assets = 2_000n * 10n ** 6n;
        const expected = (assets * deadShares) / strayUsdc;
        expect(await env.vault.convertToShares(assets)).to.equal(expected);
    });

    it("covers totalAssets fallback when trading core is never wired", async function () {
        const [admin, treasury] = await ethers.getSigners();
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        const usdc = await MockUSDC.deploy();
        const VaultCore = await ethers.getContractFactory("VaultCore");
        const vault = await VaultCore.deploy();
        await vault.initialize(admin.address, await usdc.getAddress(), treasury.address);

        const amt = 1_000_000n;
        await usdc.mintTo(await vault.getAddress(), amt);
        expect(await vault.totalAssets()).to.equal(amt * 10n ** 12n);
    });

    it("covers successful insurance unstake after cooldown", async function () {
        const { env } = await loadFixture(fixture);
        await env.usdc.mintTo(env.admin.address, 3_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(1_000_000_000n, env.admin.address);
        await env.vault.connect(env.admin).requestUnstake();
        await time.increase(7 * 24 * 3600 + 5);
        await env.vault.connect(env.admin).unstakeInsurance(1_000_000_000n, env.admin.address);
    });

    it("covers emergency escape withdraw capped success path", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();

        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        // Drain liquid balance so escape path is capped by current balance.
        await env.vault.connect(env.admin).borrow(1_500_000_000n, env.alice.address, true);

        await env.vault.connect(env.admin).triggerEmergencyMode();
        await time.increase(31 * 24 * 3600);
        await env.vault.connect(env.admin).emergencyEscapeWithdraw(1_000_000_000n);
    });

    it("covers submitClaim guardian flow and partial processClaim", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        const approvalThreshold = await env.vault.approvalThreshold();

        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 20_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(3_000_000n, env.admin.address);

        const large = approvalThreshold + 1n;
        const tx = await env.vault.connect(env.admin).submitClaim(large, 7n);
        const receipt = await tx.wait();
        const ev = receipt!.logs.find((l: any) => {
            try {
                return env.vault.interface.parseLog(l)?.name === "ClaimSubmitted";
            } catch {
                return false;
            }
        });
        const parsed = env.vault.interface.parseLog(ev!);
        const claimId = parsed!.args.claimId as bigint;

        await env.vault.connect(env.admin).approveClaim(claimId);
        await env.vault.connect(env.admin).processClaim(claimId);

        await env.vault.connect(env.admin).stakeInsurance(200_000n, env.admin.address);
        await env.vault.connect(env.admin).submitClaim(500_000n, 8n);
    });

    it("covers repay positive pnl transfer branch", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.bob.address);

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);
        await env.vault.connect(env.admin).borrow(500_000_000n, env.alice.address, true);

        const repayAmt = 200_950_000n;
        const pnl = 50_000n;
        await env.usdc.mintTo(env.bob.address, repayAmt + pnl);
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).repay(repayAmt, env.alice.address, true, pnl);
    });

    it("emits EmergencyEscapeWithdrawCapped when on-chain USDC is below pro-rata claim", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        const vaultAddr = await env.vault.getAddress();

        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 20_000_000n * 10n ** 6n);
        await env.usdc.connect(env.admin).approve(vaultAddr, ethers.MaxUint256);

        const depositAmt = 10_000_000n * 10n ** 6n;
        await env.vault.connect(env.admin).deposit(depositAmt, env.admin.address);

        const borrowAmt = 8_000_000n * 10n ** 6n;
        await env.vault.connect(env.admin).borrow(borrowAmt, env.alice.address, true);

        const leaveBal = 100n * 10n ** 6n;
        await ethers.provider.send("hardhat_impersonateAccount", [vaultAddr]);
        await ethers.provider.send("hardhat_setBalance", [vaultAddr, "0x1000000000000000000"]);
        const vaultSigner = await ethers.getSigner(vaultAddr);
        const bal = await env.usdc.balanceOf(vaultAddr);
        await env.usdc.connect(vaultSigner).transfer(env.bob.address, bal - leaveBal);
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAddr]);

        await env.vault.connect(env.admin).triggerEmergencyMode();
        await time.increase(7 * 24 * 3600 + 5);

        const shares = await env.vault.lpBalanceOf(env.admin.address);
        await expect(env.vault.connect(env.admin).emergencyEscapeWithdraw(shares)).to.emit(
            env.vault,
            "EmergencyEscapeWithdrawCapped"
        );
    });

    it("covers getInsuranceHealthRatio when protocolTVL is zero", async function () {
        const { env } = await loadFixture(fixture);
        expect(await env.vault.protocolTVL()).to.equal(0n);
        expect(await env.vault.getInsuranceHealthRatio()).to.equal(10n ** 18n);
    });

    it("covers getUtilization zero branch when totalAssets is zero", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();
        const vaultAddr = await env.vault.getAddress();

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        const stray = 500n * 10n ** 6n;
        await env.usdc.mintTo(vaultAddr, stray);
        await mockPnl.setPnl(stray * 10n ** 12n);

        expect(await env.vault.totalAssets()).to.equal(0n);
        expect(await env.vault.getUtilization()).to.equal(0n);
    });

    it("covers getConservativeTotalAssets zero when unrealized PnL liability dominates", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        await mockPnl.setPnl(ethers.MaxInt256);

        expect(await env.vault.getConservativeTotalAssets()).to.equal(0n);
    });

    it("covers triggerEmergencyMode no-op when already active", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await env.vault.connect(env.admin).triggerEmergencyMode();
        const t1 = await env.vault.emergencyModeActivatedAt();
        await env.vault.connect(env.admin).triggerEmergencyMode();
        const t2 = await env.vault.emergencyModeActivatedAt();
        expect(t2).to.equal(t1);
    });

    it("covers queueWithdrawal processWithdrawal Slippage cancel path", async function () {
        const { env } = await loadFixture(fixture);

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        const shares = await env.vault.lpBalanceOf(env.admin.address);
        await env.vault.connect(env.admin).queueWithdrawal(shares, 5_000_000_000n);

        await time.increase(86400 + 5);
        await env.vault.processWithdrawals([1n]);
    });

    it("covers queueWithdrawal processWithdrawal InsufficientLiquidity cancel path", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();

        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 8_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(3_000_000_000n, env.admin.address);

        const shares = await env.vault.lpBalanceOf(env.admin.address);
        const minAssets = 200_000_000n;
        await env.vault.connect(env.admin).queueWithdrawal(shares, minAssets);

        await env.vault.connect(env.admin).borrow(2_900_000_000n, env.alice.address, true);

        await time.increase(86400 + 5);
        await env.vault.processWithdrawals([1n]);
    });

    it("covers _removeUserRequest when processed id is not first in user queue", async function () {
        const { env } = await loadFixture(fixture);

        await env.usdc.mintTo(env.admin.address, 10_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(5_000_000_000n, env.admin.address);

        const bal = await env.vault.lpBalanceOf(env.admin.address);
        const half = bal / 2n;
        const id1 = await env.vault.connect(env.admin).queueWithdrawal.staticCall(half, 0n);
        await env.vault.connect(env.admin).queueWithdrawal(half, 0n);
        const id2 = await env.vault.connect(env.admin).queueWithdrawal.staticCall(half, 0n);
        await env.vault.connect(env.admin).queueWithdrawal(half, 0n);

        await time.increase(86400 + 5);
        await env.vault.connect(env.admin).processWithdrawals([id2]);
        await env.vault.connect(env.admin).processWithdrawals([id1]);
    });

    it("covers processWithdrawal slippage cancel (minAssets) and _removeUserRequest", async function () {
        const { env } = await loadFixture(fixture);

        await env.usdc.mintTo(env.admin.address, 10_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(5_000_000_000n, env.admin.address);

        const bal = await env.vault.lpBalanceOf(env.admin.address);
        const shares = bal / 2n;
        const expectedAssets = await env.vault.previewWithdraw(shares);
        const minAssets = expectedAssets + 1n;

        const id = await env.vault.connect(env.admin).queueWithdrawal.staticCall(shares, minAssets);
        await env.vault.connect(env.admin).queueWithdrawal(shares, minAssets);

        await time.increase(86400 + 5);
        await env.vault.connect(env.admin).processWithdrawals([id]);
    });

    it("covers coverBadDebt 24h cumulative reset before circuit check", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();

        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).resetInsuranceCircuitBreaker();

        await env.usdc.mintTo(env.admin.address, 50_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(5_000_000_000n, env.admin.address);

        const small = 100_000n;
        await env.vault.connect(env.admin).coverBadDebt(small, 1n);

        await time.increase(25 * 3600);
        await env.vault.connect(env.admin).coverBadDebt(small, 2n);
    });

    it("covers processWithdrawals skipping already-processed requests", async function () {
        const { env } = await loadFixture(fixture);

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        const half = (await env.vault.lpBalanceOf(env.admin.address)) / 2n;
        await env.vault.connect(env.admin).queueWithdrawal(half, 0n);
        await time.increase(86400 + 5);
        await env.vault.processWithdrawals([1n]);
        await env.vault.processWithdrawals([1n]);
    });

    it("covers borrow false when conservative total assets are zero", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();

        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        await mockPnl.setPnl(ethers.MaxInt256);

        expect(await env.vault.getConservativeTotalAssets()).to.equal(0n);
        expect(await env.vault.connect(env.admin).borrow.staticCall(1_000_000n, env.alice.address, true)).to.equal(false);
    });

    it("covers totalAssets catch path when getGlobalUnrealizedPnL reverts", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();

        await env.usdc.mintTo(env.admin.address, 3_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1_000_000_000n, env.admin.address);

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        await mockPnl.setShouldRevert(true);

        const bal = await env.usdc.balanceOf(await env.vault.getAddress());
        const expected = bal * 10n ** 12n;
        expect(await env.vault.totalAssets()).to.equal(expected);
    });

    it("covers getConservativeTotalAssets when positive PnL liability is below accounting total", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        await mockPnl.setPnl(10n ** 20n);

        expect(await env.vault.getConservativeTotalAssets()).to.be.gt(0n);
    });

    it("covers repay negative pnl with receiveAmount zero", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.bob.address);

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);
        await env.vault.connect(env.admin).borrow(500_000_000n, env.alice.address, true);

        const repayAmt = 400_000n;
        const pnl = -500_000n;
        await env.usdc.mintTo(env.bob.address, 1n);
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).repay(repayAmt, env.alice.address, true, pnl);
    });

    it("covers distributeSurplus when surplus does not exceed accumulated fees", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 20_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);

        const insAssets = 5_000_000_000n;
        await env.vault.connect(env.admin).stakeInsurance(insAssets, env.admin.address);

        const target = insAssets - 1_000_000n;
        const tvl = (target * 10_000n) / 1000n;
        await env.vault.connect(env.admin).setMaxProtocolTVL(tvl * 20n);
        await env.vault.connect(env.admin).updateProtocolTVL(tvl);

        await env.vault.connect(env.admin).receiveFees(5_000_000n);

        await env.vault.connect(env.admin).distributeSurplus();
    });

    it("covers coverBadDebt no-op when covered amount is zero", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
        await env.vault.connect(env.admin).resetInsuranceCircuitBreaker();

        await env.vault.connect(env.admin).coverBadDebt(0n, 0n);
    });

    it("covers getConservativeUtilization zero when conservative assets are zero", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();

        await env.usdc.mintTo(env.admin.address, 2_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1_000_000_000n, env.admin.address);

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        await mockPnl.setPnl(ethers.MaxInt256);

        expect(await env.vault.getConservativeUtilization()).to.equal(0n);
    });

    it("covers totalAssets when global unrealized PnL is negative", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();

        await env.usdc.mintTo(env.admin.address, 3_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1_000_000_000n, env.admin.address);

        const before = await env.vault.totalAssets();
        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        await mockPnl.setPnl(-1n * 10n ** 18n);

        expect(await env.vault.totalAssets()).to.equal(before + 10n ** 18n);
    });

    it("covers distributeSurplus early return when surplus is capped to zero fees", async function () {
        const { env } = await loadFixture(fixture);
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 20_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);

        const insAssets = 5_000_000_000n;
        await env.vault.connect(env.admin).stakeInsurance(insAssets, env.admin.address);

        const target = insAssets - 1_000_000n;
        const tvl = (target * 10_000n) / 1000n;
        await env.vault.connect(env.admin).setMaxProtocolTVL(tvl * 20n);
        await env.vault.connect(env.admin).updateProtocolTVL(tvl);

        expect(await env.vault.accumulatedFees()).to.equal(0n);
        await env.vault.connect(env.admin).distributeSurplus();
    });

    it("reverts deposit when emergency mode is active", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 2_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).triggerEmergencyMode();

        await expect(env.vault.connect(env.admin).deposit(1_000_000n, env.admin.address)).to.be.revertedWithCustomError(
            env.vault,
            "EmergencyModeActive"
        );
    });

    it("covers totalAssets zero when positive PnL liability meets on-chain total", async function () {
        const { env } = await loadFixture(fixture);
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();

        await env.usdc.mintTo(env.admin.address, 2_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1_000_000_000n, env.admin.address);

        const ta = await env.vault.totalAssets();
        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        await mockPnl.setPnl(ta);

        expect(await env.vault.totalAssets()).to.equal(0n);
    });

    it("reverts unstakeInsurance when post-unstake ratio would breach minRatioBps with positive protocolTVL", async function () {
        const { env } = await loadFixture(fixture);
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 5_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(1_000_000_000n, env.admin.address);
        await env.vault.connect(env.admin).setMaxProtocolTVL(50_000_000_000_000n);
        await env.vault.connect(env.admin).updateProtocolTVL(10_000_000_000n);

        await env.vault.connect(env.admin).requestUnstake();
        await time.increase(7 * 24 * 3600 + 5);

        const sh = await env.vault.insBalanceOf(env.admin.address);
        await expect(
            env.vault.connect(env.admin).unstakeInsurance(sh, env.admin.address)
        ).to.be.revertedWithCustomError(env.vault, "UnhealthyRatio");
    });

    it("covers emergencyEscapeWithdraw when computed payout and transfer are zero", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        const MockTradingCorePnl = await ethers.getContractFactory("MockTradingCorePnl");
        const mockPnl = await MockTradingCorePnl.deploy();

        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 3_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        await env.vault.connect(env.admin).triggerEmergencyMode();
        await time.increase(7 * 24 * 3600 + 5);

        await env.vault.connect(env.admin).setTradingCore(await mockPnl.getAddress());
        await mockPnl.setPnl(ethers.MaxInt256);

        const shares = await env.vault.lpBalanceOf(env.admin.address);
        await env.vault.connect(env.admin).emergencyEscapeWithdraw(shares);
    });
});
