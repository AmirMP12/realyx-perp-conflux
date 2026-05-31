import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
    ADMIN_ROLE,
    OPERATOR_ROLE,
    GUARDIAN_ROLE,
    ORACLE_ROLE,
    KEEPER_ROLE,
    LIQUIDATOR_ROLE,
    TRADING_CORE_ROLE,
    FEED_ID_BTC,
    usdc,
} from "./constants";
import { setPythPrice } from "./pyth";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Library link key format used by hardhat: "path:Name".
 */
const libKey = (name: string) => `contracts/libraries/${name}.sol:${name}`;

/**
 * Seed the OracleAggregator TWAP ring buffer for the configured market with
 * several samples spaced beyond MIN_TWAP_UPDATE_INTERVAL (30s) so the trading
 * open path's TWAP-validity gate (MIN_TWAP_DATA_POINTS = 2) is satisfied.
 * Re-pushes the Pyth price before each sample so publishTime stays fresh.
 */
export async function seedTwap(d: Deployment, price: bigint, samples = 4): Promise<void> {
    for (let i = 0; i < samples; i++) {
        await setPythPrice(d.pyth, d.feedId, price);
        await d.oracle.connect(d.oracleBot).recordPricePoint(d.market, 0);
        await time.increase(35);
    }
    // refresh the spot price after the time jumps so it is not stale
    await setPythPrice(d.pyth, d.feedId, price);
}

export interface Deployment {
    // signers
    admin: HardhatEthersSigner;
    treasury: HardhatEthersSigner;
    keeper: HardhatEthersSigner;
    liquidator: HardhatEthersSigner;
    guardian: HardhatEthersSigner;
    operator: HardhatEthersSigner;
    oracleBot: HardhatEthersSigner;
    lp: HardhatEthersSigner;
    alice: HardhatEthersSigner;
    bob: HardhatEthersSigner;
    carol: HardhatEthersSigner;
    signers: HardhatEthersSigner[];

    // contracts
    usdc: any;
    pyth: any;
    marketCalendar: any;
    dividendManager: any;
    compliance: any;
    oracle: any;
    vault: any;
    collateralRegistry: any;
    positionToken: any;
    tradingCore: any;
    tradingViews: any;
    dividendKeeper: any;

    // a configured market (crypto-style, 24x7)
    market: string;
    marketId: string;
    feedId: string;
}

/**
 * Deploy the full Realyx protocol exactly as the production deploy script does
 * (UUPS proxies + linked libraries), wire all dependencies, and return handles.
 *
 * Does NOT set up a market or seed liquidity — see `deployConfigured` for that.
 */
export async function deployProtocol(): Promise<Deployment> {
    const signers = await ethers.getSigners();
    const [admin, treasury, keeper, liquidator, guardian, operator, oracleBot, lp, alice, bob, carol] = signers;

    // ── External mocks ──
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdcToken = await MockUSDC.deploy();
    await usdcToken.waitForDeployment();

    const MockPyth = await ethers.getContractFactory("MockPythWrapper");
    const pyth = await MockPyth.deploy(3600, 1); // validTimePeriod, fee=1 wei
    await pyth.waitForDeployment();

    // ── UUPS core (order mirrors scripts/deploy.ts) ──
    const MarketCalendar = await ethers.getContractFactory("MarketCalendar");
    const marketCalendar = await upgrades.deployProxy(MarketCalendar, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await marketCalendar.waitForDeployment();

    const DividendManager = await ethers.getContractFactory("DividendManager");
    const dividendManager = await upgrades.deployProxy(DividendManager, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await dividendManager.waitForDeployment();

    const AllowListCompliance = await ethers.getContractFactory("AllowListCompliance");
    const compliance = await upgrades.deployProxy(AllowListCompliance, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await compliance.waitForDeployment();

    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    const oracle = await upgrades.deployProxy(OracleAggregator, [admin.address, await pyth.getAddress()], {
        kind: "uups",
        initializer: "initialize",
    });
    await oracle.waitForDeployment();

    const VaultCore = await ethers.getContractFactory("VaultCore");
    const vault = await upgrades.deployProxy(
        VaultCore,
        [admin.address, await usdcToken.getAddress(), treasury.address],
        { kind: "uups", initializer: "initialize" },
    );
    await vault.waitForDeployment();

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    // Plain AccessControl contract with a real constructor; deploy directly.
    const collateralRegistry = await CollateralRegistry.deploy(admin.address, await oracle.getAddress());
    await collateralRegistry.waitForDeployment();

    const PositionToken = await ethers.getContractFactory("PositionToken");
    const positionToken = await upgrades.deployProxy(
        PositionToken,
        ["RWA Position", "RWAP", "https://example.com/metadata/"],
        { kind: "uups", initializer: "initialize", unsafeAllow: ["constructor"] },
    );
    await positionToken.waitForDeployment();

    // ── Libraries for TradingCore ──
    const deployLib = async (name: string, libs?: Record<string, string>) => {
        const factory = libs
            ? await ethers.getContractFactory(name, { libraries: libs })
            : await ethers.getContractFactory(name);
        const lib = await factory.deploy();
        await lib.waitForDeployment();
        return lib.getAddress();
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

    const cleanupLib = await deployLib("CleanupLib");
    const configLib = await deployLib("ConfigLib");
    const dustLib = await deployLib("DustLib");
    const flashLoanCheck = await deployLib("FlashLoanCheck");
    const healthLib = await deployLib("HealthLib");
    const positionTriggersLib = await deployLib("PositionTriggersLib");
    const rateLimitLib = await deployLib("RateLimitLib");
    const tradingContextLib = await deployLib("TradingContextLib");
    const withdrawLib = await deployLib("WithdrawLib");

    const tradingCoreLibraries: Record<string, string> = {
        [libKey("CleanupLib")]: cleanupLib,
        [libKey("ConfigLib")]: configLib,
        [libKey("DustLib")]: dustLib,
        [libKey("FlashLoanCheck")]: flashLoanCheck,
        [libKey("FundingLib")]: fundingLib,
        [libKey("HealthLib")]: healthLib,
        [libKey("PositionTriggersLib")]: positionTriggersLib,
        [libKey("RateLimitLib")]: rateLimitLib,
        [libKey("TradingContextLib")]: tradingContextLib,
        [libKey("TradingLib")]: tradingLib,
        [libKey("WithdrawLib")]: withdrawLib,
    };

    const TradingCore = await ethers.getContractFactory("TradingCore", { libraries: tradingCoreLibraries });
    const tradingCore = await upgrades.deployProxy(
        TradingCore,
        [admin.address, await usdcToken.getAddress(), treasury.address],
        { kind: "uups", initializer: "initialize", unsafeAllowLinkedLibraries: true },
    );
    await tradingCore.waitForDeployment();

    const TradingCoreViews = await ethers.getContractFactory("TradingCoreViews");
    const tradingViews = await TradingCoreViews.deploy();
    await tradingViews.waitForDeployment();
    await tradingViews.initialize(
        await tradingCore.getAddress(),
        await vault.getAddress(),
        await oracle.getAddress(),
    );

    const DividendKeeper = await ethers.getContractFactory("DividendKeeper");
    const dividendKeeper = await upgrades.deployProxy(
        DividendKeeper,
        [admin.address, await dividendManager.getAddress()],
        { kind: "uups", initializer: "initialize" },
    );
    await dividendKeeper.waitForDeployment();

    // ── Wiring ──
    await vault.setTradingCore(await tradingCore.getAddress());
    await positionToken.setTradingCore(await tradingCore.getAddress());
    await tradingCore.setContracts(
        await vault.getAddress(),
        await oracle.getAddress(),
        await positionToken.getAddress(),
    );
    await tradingCore.setRWAContracts(
        await marketCalendar.getAddress(),
        await dividendManager.getAddress(),
        await compliance.getAddress(),
    );
    await tradingCore.setTradingViews(await tradingViews.getAddress());
    await tradingCore.setCollateralRegistry(await collateralRegistry.getAddress());
    await dividendManager.setTradingCore(await tradingCore.getAddress());
    await oracle.setMarketCalendar(await marketCalendar.getAddress());
    await oracle.registerPausable(await tradingCore.getAddress());
    await oracle.registerPausable(await vault.getAddress());

    // Grant CollateralRegistry's TRADING_CORE_ROLE to tradingCore (deposit/withdraw hooks)
    await collateralRegistry.grantRole(TRADING_CORE_ROLE, await tradingCore.getAddress());

    // ── Operational roles ──
    await oracle.grantRole(OPERATOR_ROLE, admin.address);
    await tradingCore.grantRole(OPERATOR_ROLE, admin.address);
    await tradingCore.grantRole(KEEPER_ROLE, keeper.address);
    await tradingCore.grantRole(LIQUIDATOR_ROLE, liquidator.address);
    await tradingCore.grantRole(GUARDIAN_ROLE, guardian.address);
    await vault.grantRole(GUARDIAN_ROLE, guardian.address);
    await vault.grantRole(OPERATOR_ROLE, operator.address);
    await oracle.grantRole(ORACLE_ROLE, oracleBot.address);
    await oracle.grantRole(KEEPER_ROLE, keeper.address);
    await oracle.grantRole(GUARDIAN_ROLE, guardian.address);

    return {
        admin,
        treasury,
        keeper,
        liquidator,
        guardian,
        operator,
        oracleBot,
        lp,
        alice,
        bob,
        carol,
        signers,
        usdc: usdcToken,
        pyth,
        marketCalendar,
        dividendManager,
        compliance,
        oracle,
        vault,
        collateralRegistry,
        positionToken,
        tradingCore,
        tradingViews,
        dividendKeeper,
        market: "",
        marketId: "",
        feedId: FEED_ID_BTC,
    };
}

/**
 * Full end-to-end environment: protocol + a 24x7 crypto market (BTC) with a
 * live Pyth feed at $50,000, relaxed anti-abuse limits for multi-tx tests,
 * seeded LP liquidity, and whitelisted traders.
 */
export async function deployConfigured(opts?: {
    price?: bigint; // normalized 1e18 price, default 50_000e18
    lpAmount?: bigint; // USDC, default 5,000,000
    relaxLimits?: boolean; // default true
}): Promise<Deployment> {
    const d = await deployProtocol();
    const price = opts?.price ?? 50_000n * 10n ** 18n;
    const lpAmount = opts?.lpAmount ?? usdc(5_000_000);
    const relax = opts?.relaxLimits ?? true;

    // Use a deterministic market address (a non-contract address is fine — the
    // oracle keys config by address and the protocol never calls code on it).
    const market = "0x00000000000000000000000000000000000000B7";
    const marketId = "BTC-USD";
    d.market = market;
    d.marketId = marketId;

    // ── Oracle feed + 24x7 calendar so the market is always open ──
    // maxConfidence is a uint64 in OracleAggregator; the default Pyth conf band
    // we publish is 1e14 (normalized). Use 1e15 so reads pass comfortably.
    await d.oracle.setPythFeed(market, d.feedId, 900, 10n ** 15n);
    await d.oracle.addSupportedMarket(market);
    await d.oracle.setMarketId(market, marketId);
    await d.marketCalendar.setMarketConfig(marketId, 0, 1439, 0, true); // is24x7
    await setPythPrice(d.pyth, d.feedId, price);

    // ── Seed the TWAP ring buffer so opens pass the TWAP-validity gate. ──
    // recordPricePoint enforces a 30s minimum spacing and the open path
    // requires >= MIN_TWAP_DATA_POINTS (2) samples within the 15-min window.
    await seedTwap(d, price);

    // ── List the market on TradingCore ──
    // setMarket(market, feed, maxLev, maxPos, maxExp, mmBps, imBps, maxStaleness)
    await d.tradingCore.setMarket(
        market,
        market,
        20, // maxLev
        ethers.parseUnits("100000000", 18), // maxPos (internal precision sizes)
        ethers.parseUnits("500000000", 18), // maxExp
        500, // mmBps
        1000, // imBps
        900, // maxStaleness
    );
    await d.tradingCore.setMarketId(market, marketId);

    // ── Relax anti-abuse limits for multi-tx-per-block test flows ──
    if (relax) {
        // setParams(mps, mou, mab, mef, mpp, mid, ldb)
        // minPositionSize=10 USDC, maxOracleUncertainty=0.5e18, maxActionsPerBlock=1000,
        // minExecutionFee untouched(0 keeps default), maxPositionsPerUser=200, minInteractionDelay=1, ldb skip
        await d.tradingCore.setParams(usdc(10), 5n * 10n ** 17n, 1000, 0, 200, 1, 0);
        // setLimits(uvl, gvl, lat, lai, mue, mpd): raise volume + exposure ceilings, min duration 30s
        await d.tradingCore.setLimits(
            usdc(1_000_000_000),
            usdc(100_000_000_000),
            usdc(1_000_000_000),
            300,
            usdc(900_000_000),
            30,
        );
    }

    // ── Whitelist traders (compliance is active) ──
    for (const s of [d.alice, d.bob, d.carol, d.lp, d.keeper, d.liquidator]) {
        await d.compliance.setWhitelist(s.address, true);
    }

    // ── Seed LP liquidity ──
    await d.usdc.mintTo(d.lp.address, lpAmount);
    await d.usdc.connect(d.lp).approve(await d.vault.getAddress(), lpAmount);
    await d.vault.connect(d.lp).deposit(lpAmount, d.lp.address);

    // ── Fund traders with USDC ──
    for (const s of [d.alice, d.bob, d.carol]) {
        await d.usdc.mintTo(s.address, usdc(10_000_000));
        await d.usdc.connect(s).approve(await d.tradingCore.getAddress(), ethers.MaxUint256);
    }

    return d;
}
