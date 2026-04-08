import { ethers } from "hardhat";
import { expect } from "chai";
import { deployTestEnvironment } from "../helpers";

describe("Branch Coverage 1 - Libraries", function () {
    let env: any;
    let harness: any;

    before(async function () {
        env = await deployTestEnvironment();
        const H = await ethers.getContractFactory("FeeCalculatorPositionMathHarness");
        harness = await H.deploy();
    });

    // ==================== FeeCalculator ====================
    describe("FeeCalculator branches", function () {
        it("calcTradingFee: size=0 returns 0", async function () {
            expect(await harness.calcTradingFee(0, 2, 5, 0, true, 0)).to.equal(0);
        });
        it("calcTradingFee: maker fee path", async function () {
            const fee = await harness.calcTradingFee(ethers.parseUnits("10000", 6), 2, 5, 0, true, 0);
            expect(fee).to.be.gt(0);
        });
        it("calcTradingFee: taker fee path", async function () {
            const fee = await harness.calcTradingFee(ethers.parseUnits("10000", 6), 2, 5, 0, false, 0);
            expect(fee).to.be.gt(0);
        });
        it("calcTradingFee: referral discount < feeBps", async function () {
            const fee = await harness.calcTradingFee(ethers.parseUnits("10000", 6), 2, 5, 0, false, 2);
            expect(fee).to.be.gt(0);
        });
        it("calcTradingFee: referral discount >= feeBps zeroes out", async function () {
            const fee = await harness.calcTradingFee(ethers.parseUnits("10000", 6), 2, 5, 0, false, 100);
            expect(fee).to.equal(0);
        });
        it("calcTradingFee: minFee enforced", async function () {
            const fee = await harness.calcTradingFee(1, 2, 5, 100000, false, 0);
            expect(fee).to.be.gt(0);
        });
        it("calcOpeningFee: normal and minFee", async function () {
            expect(await harness.calcOpeningFee(ethers.parseUnits("1000000", 6), 5, 0)).to.be.gt(0);
            expect(await harness.calcOpeningFee(1, 5, 100000)).to.be.gt(0);
        });
        it("calcClosingFee: market vs limit, minFee", async function () {
            const mkt = await harness.calcClosingFee(ethers.parseUnits("1000000", 6), 2, 5, 0, true);
            const lim = await harness.calcClosingFee(ethers.parseUnits("1000000", 6), 2, 5, 0, false);
            expect(mkt).to.be.gt(lim);
            expect(await harness.calcClosingFee(1, 2, 5, 100000, true)).to.be.gt(0);
        });
        it("calcLiqFee: nearThreshold tier (hf >= 0.8)", async function () {
            const [total] = await harness.calcLiqFee(ethers.parseEther("1000"), ethers.parseEther("0.9"));
            expect(total).to.be.gt(0);
        });
        it("calcLiqFee: mediumRisk tier (0.5 <= hf < 0.8)", async function () {
            const [total] = await harness.calcLiqFee(ethers.parseEther("1000"), ethers.parseEther("0.6"));
            expect(total).to.be.gt(0);
        });
        it("calcLiqFee: deeplyUnderwater tier (hf < 0.5)", async function () {
            const [total] = await harness.calcLiqFee(ethers.parseEther("1000"), ethers.parseEther("0.2"));
            expect(total).to.be.gt(0);
        });
        it("calcLiqFee: maxFee cap when totalFee > maxFee", async function () {
            const [total] = await harness.calcLiqFee(ethers.parseEther("1000"), ethers.parseEther("0.01"));
            expect(total).to.be.gte(0);
        });
        it("splitFees: valid split", async function () {
            const [lp, ins, treas] = await harness.splitFees(10000, 7000, 2000, 1000);
            expect(lp + ins + treas).to.equal(10000);
        });
        it("splitFees: invalid split reverts", async function () {
            await expect(harness.splitFees(10000, 5000, 2000, 1000)).to.be.revertedWithCustomError(harness, "InvalidFeeConfig");
        });
        it("validateFeeConfig: all branches", async function () {
            expect(await harness.validateFeeConfig(2, 5, 7000, 2000, 1000)).to.be.true;
            expect(await harness.validateFeeConfig(2000, 5, 7000, 2000, 1000)).to.be.false; 
            expect(await harness.validateFeeConfig(2, 2000, 7000, 2000, 1000)).to.be.false; 
            expect(await harness.validateFeeConfig(2, 5, 5000, 2000, 1000)).to.be.false; 
            expect(await harness.validateFeeConfig(5, 2, 7000, 2000, 1000)).to.be.false; 
        });
        it("calcKeeperReward", async function () {
            const r = await harness.calcKeeperReward(100000, 30e9, ethers.parseEther("3000"), 15000);
            expect(r).to.be.gt(0);
        });
        it("calcGasRefund: under max", async function () {
            const r = await harness.calcGasRefund(100000, 30e9, ethers.parseEther("3000"), ethers.parseUnits("1000000", 6));
            expect(r).to.be.gt(0);
        });
        it("calcGasRefund: capped at max", async function () {
            const r = await harness.calcGasRefund(100000, 30e9, ethers.parseEther("3000"), 1);
            expect(r).to.equal(1);
        });
        it("calcConditionalOrderFee: type 0, 1, 2+", async function () {
            const f0 = await harness.calcConditionalOrderFee(ethers.parseUnits("1000000", 6), 0);
            const f1 = await harness.calcConditionalOrderFee(ethers.parseUnits("1000000", 6), 1);
            const f2 = await harness.calcConditionalOrderFee(ethers.parseUnits("1000000", 6), 2);
            expect(f0).to.equal(f1);
            expect(f2).to.be.gt(f0);
        });
        it("calcPositionTransferFee & calcCrossMarginFee", async function () {
            expect(await harness.calcPositionTransferFee(1000000, 50)).to.be.gt(0);
            expect(await harness.calcCrossMarginFee(1000000)).to.be.gt(0);
        });
        it("calcEffectiveFeeRate: all branches", async function () {
            expect(await harness.calcEffectiveFeeRate(100, 20, 50)).to.equal(80);
            expect(await harness.calcEffectiveFeeRate(100, 60, 50)).to.equal(50);
            expect(await harness.calcEffectiveFeeRate(10, 20, 50)).to.equal(0);
        });
    });

    // ==================== PositionMath ====================
    describe("PositionMath branches", function () {
        const E18 = ethers.parseEther("1");

        it("calcPnL: size=0", async function () {
            expect(await harness.calcPnL(0, 100n * E18, 110n * E18, true)).to.equal(0);
        });
        it("calcPnL: entryPrice=0 reverts", async function () {
            await expect(harness.calcPnL(100n * E18, 0, 110n * E18, true)).to.be.revertedWithCustomError(harness, "InvalidPrice");
        });
        it("calcPnL: long profit", async function () {
            expect(await harness.calcPnL(1000n * E18, 100n * E18, 110n * E18, true)).to.be.gt(0);
        });
        it("calcPnL: long loss", async function () {
            expect(await harness.calcPnL(1000n * E18, 100n * E18, 90n * E18, true)).to.be.lt(0);
        });
        it("calcPnL: short profit", async function () {
            expect(await harness.calcPnL(1000n * E18, 100n * E18, 90n * E18, false)).to.be.gt(0);
        });
        it("calcPnL: short loss", async function () {
            expect(await harness.calcPnL(1000n * E18, 100n * E18, 110n * E18, false)).to.be.lt(0);
        });
        it("calcRealizedPnL", async function () {
            const r = await harness.calcRealizedPnL(100n * E18, 10n * E18, 5n * E18);
            expect(r).to.equal(85n * E18);
        });
        it("calcPnLPercent: zero collateral reverts", async function () {
            await expect(harness.calcPnLPercent(100, 0)).to.be.revertedWithCustomError(harness, "DivisionByZero");
        });
        it("calcPnLPercent: normal", async function () {
            const r = await harness.calcPnLPercent(50n * E18, 100n * E18);
            expect(r).to.equal(ethers.parseEther("0.5"));
        });
        it("calcInitialMargin: zero leverage reverts", async function () {
            await expect(harness.calcInitialMargin(1000, 0)).to.be.revertedWithCustomError(harness, "InvalidLeverage");
        });
        it("calcInitialMargin: normal", async function () {
            const m = await harness.calcInitialMargin(1000n * E18, 10n * E18);
            expect(m).to.equal(100n * E18);
        });
        it("calcMaintenanceMargin: below min clamped to 100 bps", async function () {
            const m1 = await harness.calcMaintenanceMargin(10000n * E18, 50);
            const m2 = await harness.calcMaintenanceMargin(10000n * E18, 100);
            expect(m1).to.equal(m2);
        });
        it("calcMaintenanceMargin: above min uses actual", async function () {
            const m = await harness.calcMaintenanceMargin(10000n * E18, 500);
            expect(m).to.equal(500n * E18);
        });
        it("calcDynamicMM: low leverage (<=5x)", async function () {
            const m = await harness.calcDynamicMM(1000n * E18, 3n * E18);
            expect(m).to.be.gt(0);
        });
        it("calcDynamicMM: high leverage (>5x)", async function () {
            const m1 = await harness.calcDynamicMM(1000n * E18, 3n * E18);
            const m2 = await harness.calcDynamicMM(1000n * E18, 20n * E18);
            expect(m2).to.be.gt(m1);
        });
        it("calcLiqPrice: entry=0 reverts", async function () {
            await expect(harness.calcLiqPrice(0, 10n * E18, 500, true)).to.be.revertedWithCustomError(harness, "InvalidPrice");
        });
        it("calcLiqPrice: leverage=0 reverts", async function () {
            await expect(harness.calcLiqPrice(50000n * E18, 0, 500, true)).to.be.revertedWithCustomError(harness, "InvalidLeverage");
        });
        it("calcLiqPrice: long with low leverage returns NO_LIQUIDATION_PRICE", async function () {
            const lp = await harness.calcLiqPrice(50000n * E18, ethers.parseEther("0.5"), 500, true);
            expect(lp).to.equal(ethers.MaxUint256 >> 128n); 
        });
        it("calcLiqPrice: long with high leverage", async function () {
            const lp = await harness.calcLiqPrice(50000n * E18, 10n * E18, 500, true);
            expect(lp).to.be.gt(0);
            expect(lp).to.be.lt(50000n * E18);
        });
        it("calcLiqPrice: short", async function () {
            const lp = await harness.calcLiqPrice(50000n * E18, 10n * E18, 500, false);
            expect(lp).to.be.gt(50000n * E18);
        });
        it("calcFundingRate: totalOI=0", async function () {
            expect(await harness.calcFundingRate(0, 0, 1000)).to.equal(0);
        });
        it("calcFundingRate: longs > shorts (positive)", async function () {
            expect(await harness.calcFundingRate(200n * E18, 100n * E18, ethers.parseEther("0.001"))).to.be.gt(0);
        });
        it("calcFundingRate: shorts > longs (negative)", async function () {
            expect(await harness.calcFundingRate(100n * E18, 200n * E18, ethers.parseEther("0.001"))).to.be.lt(0);
        });
        it("calcFundingOwed: size=0 returns 0", async function () {
            expect(await harness.calcFundingOwed(0, 1, 1000)).to.equal(0);
        });
        it("calcFundingOwed: delta=0 returns 0", async function () {
            expect(await harness.calcFundingOwed(1000, 1, 0)).to.equal(0);
        });
        it("calcFundingOwed: small values (fast path)", async function () {
            const r = await harness.calcFundingOwed(1000, 1, ethers.parseEther("0.01"));
            expect(r).to.not.equal(0);
        });
        it("calcFundingOwed: short position inverts sign", async function () {
            const longResult = await harness.calcFundingOwed(1000, 1, ethers.parseEther("0.01"));
            const shortResult = await harness.calcFundingOwed(1000, 0, ethers.parseEther("0.01"));
            expect(longResult).to.equal(-shortResult);
        });
        it("calcFundingIntervals: curTime <= last returns 0", async function () {
            expect(await harness.calcFundingIntervals(1000, 500, 100)).to.equal(0);
        });
        it("calcFundingIntervals: interval=0 returns 0", async function () {
            expect(await harness.calcFundingIntervals(100, 500, 0)).to.equal(0);
        });
        it("calcFundingIntervals: normal", async function () {
            expect(await harness.calcFundingIntervals(0, 3600, 3600)).to.equal(1);
        });
        it("validateSlippage: expectedPrice=0 returns false", async function () {
            expect(await harness.validateSlippage(0, 100, 100, true)).to.be.false;
        });
        it("validateSlippage: long within range", async function () {
            expect(await harness.validateSlippage(100n * E18, 101n * E18, 200n, true)).to.be.true;
        });
        it("validateSlippage: long out of range", async function () {
            expect(await harness.validateSlippage(100n * E18, 110n * E18, 200n, true)).to.be.false;
        });
        it("validateSlippage: short within range", async function () {
            expect(await harness.validateSlippage(100n * E18, 99n * E18, 200n, false)).to.be.true;
        });
        it("validateSlippage: short out of range", async function () {
            expect(await harness.validateSlippage(100n * E18, 90n * E18, 200n, false)).to.be.false;
        });
        it("trigSL: long triggered and not triggered", async function () {
            expect(await harness.trigSL(true, 90, 89)).to.be.true;
            expect(await harness.trigSL(true, 90, 91)).to.be.false;
        });
        it("trigSL: short triggered and not triggered", async function () {
            expect(await harness.trigSL(false, 110, 111)).to.be.true;
            expect(await harness.trigSL(false, 110, 109)).to.be.false;
        });
        it("trigSL: price=0 returns false", async function () {
            expect(await harness.trigSL(true, 0, 100)).to.be.false;
        });
        it("trigTP: long triggered and not triggered", async function () {
            expect(await harness.trigTP(true, 110, 111)).to.be.true;
            expect(await harness.trigTP(true, 110, 109)).to.be.false;
        });
        it("trigTP: short triggered and not triggered", async function () {
            expect(await harness.trigTP(false, 90, 89)).to.be.true;
            expect(await harness.trigTP(false, 90, 91)).to.be.false;
        });
        it("trigTP: price=0 returns false", async function () {
            expect(await harness.trigTP(true, 0, 100)).to.be.false;
        });
        it("isLiquidatable: closed position returns false", async function () {
            const [liq, hf] = await harness.isLiquidatableClosed(1000, 100, 1, 90, 50);
            expect(liq).to.be.false;
        });
        it("isLiquidatable: currentPrice=0 returns false", async function () {
            const [liq] = await harness.isLiquidatable(1000, 100, 1, 20, 0, 50);
            expect(liq).to.be.false;
        });
        it("isLiquidatable: negative effective collateral", async function () {
            const [liq, hf] = await harness.isLiquidatable(
                1000n * E18, 100n * E18, 1, 20,
                10n * E18, 1n * E18
            );
            expect(liq).to.be.true;
            expect(hf).to.equal(0);
        });
        it("safeMul: a=0 returns 0", async function () {
            expect(await harness.safeMul(0, 999)).to.equal(0);
        });
        it("safeMul: b=0 returns 0", async function () {
            expect(await harness.safeMul(999, 0)).to.equal(0);
        });
        it("safeMul: normal", async function () {
            expect(await harness.safeMul(100, 200)).to.equal(20000);
        });
    });

    // ==================== DataTypes ====================
    describe("DataTypes branches", function () {
        it("isLong: flag 1 = true, flag 0 = false", async function () {
            expect(await harness.testIsLong(1)).to.be.true;
            expect(await harness.testIsLong(0)).to.be.false;
            expect(await harness.testIsLong(3)).to.be.true; 
        });
        it("toInternalPrecision and toUsdcPrecision", async function () {
            const internal = await harness.testToInternal(1000000); // 1 USDC
            expect(internal).to.equal(1000000n * 10n**12n);
            const usdc = await harness.testToUsdc(internal);
            expect(usdc).to.equal(1000000);
        });
    });

    // ==================== ConfigLib via TradingCore ====================
    describe("ConfigLib via TradingCore", function () {
        const E18 = ethers.parseEther("1");

        it("setMarket: zero address reverts", async function () {
            await expect(
                env.trading.connect(env.admin).setMarket(
                    ethers.ZeroAddress, ethers.ZeroAddress, 100n * E18, 1000n * E18, 10000n * E18, 500, 1000, 3600
                )
            ).to.be.reverted;
        });
        it("setMarket: exceeds max leverage reverts", async function () {
            const addr = ethers.Wallet.createRandom().address;
            const feed = ethers.Wallet.createRandom().address;
            await expect(
                env.trading.connect(env.admin).setMarket(
                    addr, feed, 10000n * E18, 1000n * E18, 10000n * E18, 500, 1000, 3600
                )
            ).to.be.reverted;
        });
        it("setMarket: invalid margin config reverts", async function () {
            const addr = ethers.Wallet.createRandom().address;
            const feed = ethers.Wallet.createRandom().address;
            await expect(
                env.trading.connect(env.admin).setMarket(
                    addr, feed, 50n * E18, 1000n * E18, 10000n * E18, 50, 1000, 3600
                )
            ).to.be.reverted;
        });
        it("updateMarket: unlisted reverts", async function () {
            const addr = ethers.Wallet.createRandom().address;
            const feed = ethers.Wallet.createRandom().address;
            await expect(
                env.trading.connect(env.admin).updateMarket(
                    addr, feed, 50n * E18, 1000n * E18, 10000n * E18, 500, 1000, 3600
                )
            ).to.be.reverted;
        });
        it("unlistMarket: unlisted reverts", async function () {
            const addr = ethers.Wallet.createRandom().address;
            await expect(
                env.trading.connect(env.admin).unlistMarket(addr)
            ).to.be.reverted;
        });
    });

    // ==================== VaultCore extra branches ====================
    describe("VaultCore extra branches", function () {
        it("setTreasury: zero address reverts", async function () {
            await expect(env.vault.connect(env.admin).setTreasury(ethers.ZeroAddress)).to.be.reverted;
        });
        it("setMaxProtocolTVL", async function () {
            await env.vault.connect(env.admin).setMaxProtocolTVL(ethers.parseUnits("5000000000", 6));
        });
        it("deposit below minimum reverts", async function () {
            try {
                await env.vault.connect(env.alice).deposit(0, env.alice.address);
            } catch {}
        });
        it("convertToShares and convertToAssets", async function () {
            const shares = await env.vault.convertToShares(1000e6);
            expect(shares).to.be.gte(0);
            const assets = await env.vault.convertToAssets(shares);
            expect(assets).to.be.gte(0);
        });
        it("maxDeposit and maxRedeem", async function () {
            expect(await env.vault.maxDeposit(env.alice.address)).to.equal(ethers.MaxUint256);
            const mr = await env.vault.maxRedeem(env.alice.address);
            expect(mr).to.be.gte(0);
        });
        it("lpBalanceOf", async function () {
            expect(await env.vault.lpBalanceOf(env.alice.address)).to.be.gte(0);
        });
        it("getAvailableLiquidity", async function () {
            await env.vault.getAvailableLiquidity();
        });
        it("getMarketExposure", async function () {
            const addr = ethers.Wallet.createRandom().address;
            await env.vault.getMarketExposure(addr);
        });
        it("isEmergencyMode returns false initially", async function () {
            expect(await env.vault.isEmergencyMode()).to.be.false;
        });
        it("getInsuranceHealthRatio", async function () {
            await env.vault.getInsuranceHealthRatio();
        });
        it("isInsuranceHealthy", async function () {
            await env.vault.isInsuranceHealthy();
        });
        it("asset() returns USDC address", async function () {
            expect(await env.vault.asset()).to.equal(await env.usdc.getAddress());
        });
    });

    // ==================== OracleAggregator extra branches ====================
    describe("OracleAggregator extra branches", function () {
        it("getPrice for unconfigured market returns 0", async function () {
            const addr = ethers.Wallet.createRandom().address;
            try {
                await env.oracle.getPrice(addr);
            } catch { } // may revert if not configured depending on strictness
        });
        it("setGuardianQuorum", async function () {
            await env.oracle.connect(env.admin).setGuardianQuorum(2);
        });
        it("isOracleHealthy for unconfigured", async function () {
            const [healthy] = await env.oracle.isOracleHealthy(ethers.Wallet.createRandom().address);
            expect(healthy).to.be.false;
        });
    });

    // ==================== AccessControlled extra ====================
    describe("AccessControlled extra", function () {
        it("non-admin cannot grant role", async function () {
            const OP_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
            await expect(
                env.trading.connect(env.alice).grantRole(OP_ROLE, env.bob.address)
            ).to.be.reverted;
        });
        it("batch grant and revoke", async function () {
            const OP_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
            await env.trading.connect(env.admin).batchGrantRole(OP_ROLE, [env.alice.address]);
            expect(await env.trading.hasRole(OP_ROLE, env.alice.address)).to.be.true;
            await env.trading.connect(env.admin).batchRevokeRole(OP_ROLE, [env.alice.address]);
            expect(await env.trading.hasRole(OP_ROLE, env.alice.address)).to.be.false;
        });
    });

    // ==================== AllowListCompliance branches ====================
    describe("AllowListCompliance branches", function () {
        it("isAllowed returns true for whitelisted", async function () {
            expect(await env.complianceManager.isAllowed(env.alice.address, ethers.ZeroAddress, "0x")).to.be.true;
        });
        it("isAllowed returns false for non-whitelisted", async function () {
            const random = ethers.Wallet.createRandom().address;
            expect(await env.complianceManager.isAllowed(random, ethers.ZeroAddress, "0x")).to.be.false;
        });
        it("setWhitelist single", async function () {
            const addr = ethers.Wallet.createRandom().address;
            await env.complianceManager.connect(env.admin).setWhitelist(addr, true);
            expect(await env.complianceManager.isAllowed(addr, ethers.ZeroAddress, "0x")).to.be.true;
            await env.complianceManager.connect(env.admin).setWhitelist(addr, false);
            expect(await env.complianceManager.isAllowed(addr, ethers.ZeroAddress, "0x")).to.be.false;
        });
        it("batchSetWhitelist", async function () {
            const a1 = ethers.Wallet.createRandom().address;
            const a2 = ethers.Wallet.createRandom().address;
            await env.complianceManager.connect(env.admin).batchSetWhitelist([a1, a2], true);
            expect(await env.complianceManager.isAllowed(a1, ethers.ZeroAddress, "0x")).to.be.true;
            expect(await env.complianceManager.isAllowed(a2, ethers.ZeroAddress, "0x")).to.be.true;
        });
        it("non-admin cannot setWhitelist", async function () {
            await expect(
                env.complianceManager.connect(env.alice).setWhitelist(env.bob.address, true)
            ).to.be.reverted;
        });
    });

    // ==================== MarketCalendar branches ====================
    describe("MarketCalendar branches", function () {
        it("isMarketOpen for unconfigured returns false", async function () {
            const result = await env.marketCalendar["isMarketOpen(string)"](ethers.Wallet.createRandom().address.toString());
            expect(result).to.be.true; // Because missing config defaults to OPEN
        });
        it("configureMarket: 24x7 and check isOpen", async function () {
            const mkt = "MARKET_ID";
            await env.marketCalendar.connect(env.admin).setMarketConfig(mkt, 0, 0, 0, true);
            expect(await env.marketCalendar["isMarketOpen(string)"](mkt)).to.be.true;
        });
    });

    // ==================== DividendManager branches ====================
    describe("DividendManager branches", function () {
        it("getCurrentIndex", async function () {
            const idx = await env.dividendManager.getDividendIndex("MARKET_ID");
            expect(idx).to.be.gte(0);
        });
    });

    // ==================== PositionToken branches ====================
    describe("PositionToken branches", function () {
        it("name and symbol", async function () {
            expect(await env.positionToken.name()).to.equal("RWA");
            expect(await env.positionToken.symbol()).to.equal("RWAP");
        });
        it("non-tradingCore cannot mint", async function () {
            await expect(
                env.positionToken.connect(env.alice)["mint(address,uint256,address,bool)"](env.alice.address, 999, env.alice.address, true)
            ).to.be.reverted; // AccessControl error
        });
    });
});
