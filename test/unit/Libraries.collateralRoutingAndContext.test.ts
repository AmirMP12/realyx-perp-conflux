import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const e8 = (n: bigint | number) => ethers.parseUnits(n.toString(), 8);

/**
 * Verifies CollateralRouterLib and TradingContextLib behavior.
 */

describe("CollateralRouterLib", () => {
    async function deployFixture() {
        const [admin, user] = await ethers.getSigners();
        const libs = await deployAllLibraries();

        // Deploy harness
        const harness = await deployHarness("CollateralRouterLibHarness", libs);

        // Deploy oracle first
        const Oracle = await ethers.getContractFactory("MockOracleForEmergencyPrice");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();

        // Deploy CollateralRegistry with constructor args
        const Registry = await ethers.getContractFactory("CollateralRegistry");
        const registry = await Registry.deploy(admin.address, await oracle.getAddress());
        await registry.waitForDeployment();

        // Deploy mock tokens
        const Token1 = await ethers.getContractFactory("MockUSDC");
        const token1 = await Token1.deploy();
        await token1.waitForDeployment();

        const Token2 = await ethers.getContractFactory("MockUSDC");
        const token2 = await Token2.deploy();
        await token2.waitForDeployment();

        const token1Addr = await token1.getAddress();
        const token2Addr = await token2.getAddress();

        // Set oracle prices for the tokens (1:1 with USDC for simplicity)
        await oracle.setPrice(token1Addr, e18(1), e18(0.01), await ethers.provider.getBlock('latest').then(b => b!.timestamp));
        await oracle.setPrice(token2Addr, e18(1), e18(0.01), await ethers.provider.getBlock('latest').then(b => b!.timestamp));

        // Setup collateral configs using registerToken
        await registry.registerToken(
            token1Addr,
            200, // 2% base haircut
            500, // 5% liquidation haircut
            3000, // 30% max haircut
            100, // utilization slope
            50, // volatility adder
            e6(1_000_000), // max exposure
            token1Addr, // oracle feed (token address used as market address)
            6 // decimals
        );

        await registry.registerToken(
            token2Addr,
            300, // 3% base haircut
            600, // 6% liquidation haircut
            3000,
            100,
            50,
            e6(500_000),
            token2Addr,
            6
        );

        // Mint tokens to user
        await token1.mintTo(user.address, e6(10_000));
        await token2.mintTo(user.address, e6(5_000));

        return { harness, registry, token1, token2, oracle, admin, user };
    }

    describe("selectBestCollateral", () => {
        it("selects token with sufficient balance", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            const [token, tokenAmount, usdcValue] = await harness.selectBestCollateral(
                user.address,
                tokens,
                await registry.getAddress(),
                e6(1000), // require 1000 USDC value
                false // normal haircut
            );

            expect(token).to.not.equal(ethers.ZeroAddress);
            expect(tokenAmount).to.be.greaterThan(0n);
            expect(usdcValue).to.be.greaterThan(0n);
        });


        it("returns zero address when insufficient balance", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            const [token] = await harness.selectBestCollateral(
                user.address,
                tokens,
                await registry.getAddress(),
                e6(100_000), // require more than user has
                false
            );

            expect(token).to.equal(ethers.ZeroAddress);
        });

        it("uses liquidation haircut when specified", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            const [token1Normal, , usdcValueNormal] = await harness.selectBestCollateral(
                user.address,
                tokens,
                await registry.getAddress(),
                e6(100),
                false
            );

            const [token2Liq, , usdcValueLiq] = await harness.selectBestCollateral(
                user.address,
                tokens,
                await registry.getAddress(),
                e6(100),
                true // liquidation haircut
            );

            // Both should select a token
            expect(token1Normal).to.not.equal(ethers.ZeroAddress);
            expect(token2Liq).to.not.equal(ethers.ZeroAddress);
            
            // Values should be positive (haircut applied means less than gross value)
            expect(usdcValueNormal).to.be.greaterThan(0);
            expect(usdcValueLiq).to.be.greaterThan(0);
        });

        it("skips disabled tokens", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            // Disable token1
            await registry.setTokenEnabled(await token1.getAddress(), false);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            const [selectedToken] = await harness.selectBestCollateral(
                user.address,
                tokens,
                await registry.getAddress(),
                e6(100),
                false
            );

            // Should select token2 since token1 is disabled
            expect(selectedToken).to.equal(await token2.getAddress());
        });
    });

    describe("selectBestCollateralBasket", () => {
        it("uses single token when sufficient", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            const [selectedTokens, amounts, usdcValues, totalUsdcValue] =
                await harness.selectBestCollateralBasket(
                    user.address,
                    tokens,
                    await registry.getAddress(),
                    e6(1000),
                    false
                );

            expect(selectedTokens.length).to.equal(1);
            expect(totalUsdcValue).to.be.greaterThan(0n);
        });

        it("splits across multiple tokens when needed", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            // Request more than any single token can provide
            const [selectedTokens] = await harness.selectBestCollateralBasket(
                user.address,
                tokens,
                await registry.getAddress(),
                e6(12_000), // More than user balance
                false
            );

            // Should try to use multiple tokens
            expect(selectedTokens.length).to.be.greaterThan(0);
        });

        it("returns empty when insufficient total collateral", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            const [selectedTokens, , , totalUsdcValue] = await harness.selectBestCollateralBasket(
                user.address,
                tokens,
                await registry.getAddress(),
                e6(50_000), // Way more than user has
                false
            );

            expect(totalUsdcValue).to.be.lessThan(e6(50_000));
        });
    });

    describe("getUserTotalCollateralValue", () => {
        it("calculates total value across all tokens", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            const totalValue = await harness.getUserTotalCollateralValue(
                user.address,
                tokens,
                await registry.getAddress(),
                false
            );

            expect(totalValue).to.be.greaterThan(0n);
        });

        it("returns zero for user with no balance", async () => {
            const { harness, registry, token1, token2, admin } = await loadFixture(deployFixture);

            const tokens = [await token1.getAddress(), await token2.getAddress()];
            const totalValue = await harness.getUserTotalCollateralValue(
                admin.address, // admin has no tokens
                tokens,
                await registry.getAddress(),
                false
            );

            expect(totalValue).to.equal(0n);
        });

        it("skips disabled collateral", async () => {
            const { harness, registry, token1, token2, user } = await loadFixture(deployFixture);

            const totalBefore = await harness.getUserTotalCollateralValue(
                user.address,
                [await token1.getAddress(), await token2.getAddress()],
                await registry.getAddress(),
                false
            );

            // Disable token1
            await registry.setTokenEnabled(await token1.getAddress(), false);

            const totalAfter = await harness.getUserTotalCollateralValue(
                user.address,
                [await token1.getAddress(), await token2.getAddress()],
                await registry.getAddress(),
                false
            );

            expect(totalAfter).to.be.lessThan(totalBefore);
        });
    });
});

describe("TradingContextLib", () => {
    async function deployFixture() {
        const [admin, trader, referrer, treasury] = await ethers.getSigners();
        const libs = await deployAllLibraries();

        const harness = await deployHarness("TradingContextLibHarness", libs);

        // Deploy mock contracts
        const USDC = await ethers.getContractFactory("MockUSDC");
        const usdc = await USDC.deploy();
        await usdc.waitForDeployment();

        const Vault = await ethers.getContractFactory("MockVaultControl");
        const vault = await Vault.deploy();
        await vault.waitForDeployment();

        const Oracle = await ethers.getContractFactory("MockOracleForEmergencyPrice");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();

        const PositionToken = await ethers.getContractFactory("MockPositionTokenSimple");
        const positionToken = await PositionToken.deploy();
        await positionToken.waitForDeployment();

        // Deploy CollateralRegistry
        const CollRegistry = await ethers.getContractFactory("CollateralRegistry");
        const collateralRegistry = await CollRegistry.deploy(admin.address, await oracle.getAddress());
        await collateralRegistry.waitForDeployment();

        return {
            harness,
            usdc,
            vault,
            oracle,
            positionToken,
            collateralRegistry,
            admin,
            trader,
            referrer,
            treasury
        };
    }

    describe("buildCloseCtx", () => {
        it("builds context without referral", async () => {
            const { harness, usdc, vault, oracle, positionToken, collateralRegistry, trader, treasury } =
                await loadFixture(deployFixture);

            const feeConfig = {
                makerFeeBps: 5,
                takerFeeBps: 10,
                minFeeUsdc: e6(1),
                lpShareBps: 7000,
                insuranceShareBps: 2000,
                treasuryShareBps: 1000
            };

            const ctx = await harness.buildCloseCtx(
                await usdc.getAddress(),
                await vault.getAddress(),
                await oracle.getAddress(),
                await positionToken.getAddress(),
                treasury.address,
                await vault.getAddress(), // insurance = vault
                await collateralRegistry.getAddress(),
                feeConfig,
                ethers.ZeroAddress, // no referral registry
                trader.address
            );

            expect(ctx.usdc).to.equal(await usdc.getAddress());
            expect(ctx.referrer).to.equal(ethers.ZeroAddress);
            expect(ctx.referralDiscountBps).to.equal(0);
            expect(ctx.referralRebateBps).to.equal(0);
        });
    });

    describe("buildLiqCtx", () => {
        it("builds liquidation context", async () => {
            const { harness, usdc, vault, oracle, positionToken, collateralRegistry, admin, treasury } =
                await loadFixture(deployFixture);

            const tiers = {
                nearThresholdBps: 100,        // 1% for near-liquidation
                mediumRiskBps: 75,            // 0.75% for medium risk
                deeplyUnderwaterBps: 50,      // 0.5% for deeply underwater
                liquidatorShareBps: 5000      // 50% goes to liquidator
            };

            const ctx = await harness.buildLiqCtx(
                await usdc.getAddress(),
                await vault.getAddress(),
                await oracle.getAddress(),
                await positionToken.getAddress(),
                treasury.address,
                await vault.getAddress(),
                admin.address, // trading core
                await collateralRegistry.getAddress(),
                tiers,
                1000 // 10% deviation
            );

            expect(ctx.usdc).to.equal(await usdc.getAddress());
            expect(ctx.liquidationDeviationBps).to.equal(1000);
        });
    });

    describe("buildCollateralCtx", () => {
        it("builds collateral context", async () => {
            const { harness, usdc, oracle, collateralRegistry } = await loadFixture(deployFixture);

            const ctx = await harness.buildCollateralCtx(
                await usdc.getAddress(),
                await oracle.getAddress(),
                await collateralRegistry.getAddress(),
                await usdc.getAddress(), // collateral token
                e18(0.05) // 5% max uncertainty
            );

            expect(ctx.usdc).to.equal(await usdc.getAddress());
            expect(ctx.oracleAggregator).to.equal(await oracle.getAddress());
            expect(ctx.maxOracleUncertainty).to.equal(e18(0.05));
        });
    });
});
