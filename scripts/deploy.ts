import { ethers, upgrades } from "hardhat";
import {
    getPythAddressForDeploy,
    getTreasuryAddress,
    getUsdcOrThrow,
    hasRealPythForDeploy,
    isTestnet,
    type NetworkName,
} from "./helpers";

const NETWORK_GAS: Record<number, { maxDeployGas: number; minGasPriceGwei: number }> = {
    1030: { maxDeployGas: 20_000_000, minGasPriceGwei: 2 }, // Conflux
    71: { maxDeployGas: 20_000_000, minGasPriceGwei: 2 }, // Conflux Testnet
};
const DEFAULT_NETWORK_GAS = { maxDeployGas: 16_000_000, minGasPriceGwei: 5 };

type GasOverrides = { gasPrice: bigint; gasLimit?: number };

export type DeployGasOptions = {
    normal: GasOverrides | undefined;
    heavy: GasOverrides | undefined;
};

async function getDeployGasOptions(): Promise<DeployGasOptions> {
    const envGwei = process.env.GAS_PRICE_GWEI?.trim();
    const provider = ethers.provider;
    const network = await provider.getNetwork();
    const isLive = network.chainId !== 31337n;
    const config = NETWORK_GAS[Number(network.chainId)] ?? DEFAULT_NETWORK_GAS;

    if (!isLive) {
        return { normal: undefined, heavy: undefined };
    }

    let gasPrice: bigint;
    if (envGwei) {
        gasPrice = BigInt(Math.floor(parseFloat(envGwei) * 1e9));
        if (gasPrice <= 0n) return { normal: undefined, heavy: undefined };
        console.log(
            "Using gas price from GAS_PRICE_GWEI:",
            envGwei,
            "gwei (network:",
            network.chainId.toString() + ")",
        );
    } else {
        const minWei = BigInt(Math.ceil(config.minGasPriceGwei * 1e9));
        try {
            const fee = await provider.getFeeData();
            const raw = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
            const bumped = raw > 0n ? (raw * 150n) / 100n : minWei;
            gasPrice = bumped > minWei ? bumped : minWei;
        } catch {
            gasPrice = minWei;
        }
        console.log(
            "Gas:",
            Number(gasPrice) / 1e9,
            "gwei (min",
            config.minGasPriceGwei,
            "), heavy limit:",
            config.maxDeployGas,
            "only for TradingCore/TradingCoreViews",
        );
    }

    const normal: GasOverrides = { gasPrice };
    const heavy: GasOverrides = { gasPrice, gasLimit: config.maxDeployGas };
    return { normal, heavy };
}

function isUnderpriced(e: unknown): boolean {
    const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "";
    return msg.includes("replacement transaction underpriced");
}

async function withRetryUnderpriced<T>(
    overrides: GasOverrides | undefined,
    fn: (o: GasOverrides | undefined) => Promise<T>,
    label?: string,
): Promise<T> {
    let current = overrides ? { ...overrides } : undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await fn(current);
        } catch (e) {
            if (attempt < 2 && isUnderpriced(e) && current?.gasPrice) {
                current = { ...current, gasPrice: (current.gasPrice * 150n) / 100n };
                console.log(
                    "Retrying (replacement transaction underpriced) with gas",
                    Number(current.gasPrice) / 1e9,
                    "gwei" + (label ? `: ${label}` : ""),
                );
            } else throw e;
        }
    }
    throw new Error("unreachable");
}

export interface DeployResult {
    /** On testnet we deploy MockUSDC; real USDC is not used. Use `contracts.usdc` only. */
    usdcIsMock: boolean;
    mockUsdc?: string;
    /** When true, we use MockPyth; real Pyth is not used. Use `contracts.pyth` only. */
    pythIsMock: boolean;
    mockPyth?: string;
    marketCalendar: string;
    dividendManager: string;
    complianceManager: string;
    oracleAggregator: string;
    vaultCore: string;
    positionToken: string;
    tradingCore: string;
    tradingCoreViews: string;
    dividendKeeper: string;
    usdc: string;
    pyth: string;
    collateralRegistry: string;
    copyRegistry: string;
    referralRegistry: string;
}

export async function deployAll(network: NetworkName): Promise<DeployResult> {
    const [deployer] = await ethers.getSigners();
    const admin = deployer.address;
    const treasury = getTreasuryAddress();

    const gasOpts = await getDeployGasOptions();
    const normalOverrides = gasOpts.normal;
    const heavyOverrides = gasOpts.heavy;
    const txOverrides = normalOverrides ? { txOverrides: normalOverrides } : {};
    const heavyTxOverrides = heavyOverrides ? { txOverrides: heavyOverrides } : {};

    let usdcAddress: string;
    let mockUsdcAddress: string | undefined;
    let pythAddress: string;
    let mockPythAddress: string | undefined;

    const envUsdc = process.env.USDC_ADDRESS?.trim();
    if (envUsdc) {
        usdcAddress = envUsdc;
        console.log("Using USDC from env (USDC_ADDRESS):", usdcAddress);
    } else if (isTestnet(network)) {
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        const mockUsdc = await MockUSDC.deploy(...(normalOverrides ? [normalOverrides] : []));
        await mockUsdc.waitForDeployment();
        mockUsdcAddress = await mockUsdc.getAddress();
        usdcAddress = mockUsdcAddress;
        console.log("MockUSDC deployed (USDC_ADDRESS empty):", mockUsdcAddress);
    } else {
        usdcAddress = getUsdcOrThrow(network);
        console.log("Using USDC at:", usdcAddress);
    }

    if (hasRealPythForDeploy(network)) {
        pythAddress = getPythAddressForDeploy(network)!;
        console.log("Using Pyth at:", pythAddress);
    } else {
        const MockPyth = await ethers.getContractFactory("MockPythWrapper");
        const mockPyth = await MockPyth.deploy(3600, 0, ...(normalOverrides ? [normalOverrides] : []));
        await mockPyth.waitForDeployment();
        pythAddress = await mockPyth.getAddress();
        mockPythAddress = pythAddress;
        console.log("MockPyth deployed (no real Pyth for this network):", pythAddress);
    }

    const MarketCalendar = await ethers.getContractFactory("MarketCalendar");
    const marketCalendarProxy = await upgrades.deployProxy(MarketCalendar, [admin], {
        kind: "uups",
        initializer: "initialize",
        ...txOverrides,
    });
    await marketCalendarProxy.waitForDeployment();
    const marketCalendar = await marketCalendarProxy.getAddress();
    console.log("MarketCalendar (proxy):", marketCalendar);

    const DividendManager = await ethers.getContractFactory("DividendManager");
    const dividendManagerProxy = await upgrades.deployProxy(DividendManager, [admin], {
        kind: "uups",
        initializer: "initialize",
        ...txOverrides,
    });
    await dividendManagerProxy.waitForDeployment();
    const dividendManager = await dividendManagerProxy.getAddress();
    console.log("DividendManager (proxy):", dividendManager);

    const AllowListCompliance = await ethers.getContractFactory("AllowListCompliance");
    const complianceProxy = await upgrades.deployProxy(AllowListCompliance, [admin], {
        kind: "uups",
        initializer: "initialize",
        ...txOverrides,
    });
    await complianceProxy.waitForDeployment();
    const complianceManager = await complianceProxy.getAddress();
    console.log("AllowListCompliance (proxy):", complianceManager);

    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    const oracleProxy = await upgrades.deployProxy(OracleAggregator, [admin, pythAddress], {
        kind: "uups",
        initializer: "initialize",
        ...txOverrides,
    });
    await oracleProxy.waitForDeployment();
    const oracleAggregator = await oracleProxy.getAddress();
    console.log("OracleAggregator (proxy):", oracleAggregator);

    const VaultCore = await ethers.getContractFactory("VaultCore");
    const vaultProxy = await upgrades.deployProxy(VaultCore, [admin, usdcAddress, treasury], {
        kind: "uups",
        initializer: "initialize",
        ...txOverrides,
    });
    await vaultProxy.waitForDeployment();
    const vaultCore = await vaultProxy.getAddress();
    console.log("VaultCore (proxy):", vaultCore);

    // CollateralRegistry is a non-upgradeable AccessControl contract with a
    // constructor `(admin, oracleAggregator)` — not a UUPS proxy.
    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    const collateralRegistryContract = await CollateralRegistry.deploy(
        admin,
        oracleAggregator,
        ...(normalOverrides ? [normalOverrides] : []),
    );
    await collateralRegistryContract.waitForDeployment();
    const collateralRegistry = await collateralRegistryContract.getAddress();
    console.log("CollateralRegistry:", collateralRegistry);

    // CopyRegistry — UUPS proxy, Ownable, owner = admin.
    const CopyRegistry = await ethers.getContractFactory("CopyRegistry");
    const copyRegistryProxy = await upgrades.deployProxy(CopyRegistry, [admin], {
        kind: "uups",
        initializer: "initialize",
        ...txOverrides,
    });
    await copyRegistryProxy.waitForDeployment();
    const copyRegistry = await copyRegistryProxy.getAddress();
    console.log("CopyRegistry (proxy):", copyRegistry);

    // ReferralRegistry — UUPS proxy. initialize(admin, defaultDiscountBps, defaultRebateBps).
    const referralDefaultDiscountBps = Number(process.env.REFERRAL_DEFAULT_DISCOUNT_BPS ?? "500"); // 5%
    const referralDefaultRebateBps = Number(process.env.REFERRAL_DEFAULT_REBATE_BPS ?? "1000"); // 10%
    const ReferralRegistry = await ethers.getContractFactory("ReferralRegistry");
    const referralRegistryProxy = await upgrades.deployProxy(
        ReferralRegistry,
        [admin, referralDefaultDiscountBps, referralDefaultRebateBps],
        {
            kind: "uups",
            initializer: "initialize",
            ...txOverrides,
        },
    );
    await referralRegistryProxy.waitForDeployment();
    const referralRegistry = await referralRegistryProxy.getAddress();
    console.log("ReferralRegistry (proxy):", referralRegistry);

    const PositionToken = await ethers.getContractFactory("PositionToken");
    const positionTokenProxy = await upgrades.deployProxy(
        PositionToken,
        ["RWA Position", "RWAP", "https://example.com/metadata/"],
        {
            kind: "uups",
            initializer: "initialize",
            unsafeAllow: ["constructor"],
            ...txOverrides,
        },
    );
    await positionTokenProxy.waitForDeployment();
    const positionToken = await positionTokenProxy.getAddress();
    console.log("PositionToken (proxy):", positionToken);

    // Deploy libraries required by TradingCore
    const libAddr = (name: string) => `contracts/libraries/${name}.sol:${name}`;
    const deployLib = async (name: string): Promise<string> => {
        const Lib = await ethers.getContractFactory(name);
        const lib = await Lib.deploy(...(normalOverrides ? [normalOverrides] : []));
        await lib.waitForDeployment();
        const addr = await lib.getAddress();
        console.log(`${name}:`, addr);
        return addr;
    };

    // Phase 1: Libraries used by TradingLib
    const dividendSettlementLib = await deployLib("DividendSettlementLib");
    const fundingLib = await deployLib("FundingLib");
    const liquidationLib = await deployLib("LiquidationLib");
    const positionCloseLib = await deployLib("PositionCloseLib");

    // Phase 2: TradingLib
    const TradingLibFactory = await ethers.getContractFactory("TradingLib", {
        libraries: {
            [libAddr("DividendSettlementLib")]: dividendSettlementLib,
            [libAddr("FundingLib")]: fundingLib,
            [libAddr("LiquidationLib")]: liquidationLib,
            [libAddr("PositionCloseLib")]: positionCloseLib,
        },
    });
    const tradingLib = await TradingLibFactory.deploy(...(normalOverrides ? [normalOverrides] : []));
    await tradingLib.waitForDeployment();
    const tradingLibAddress = await tradingLib.getAddress();
    console.log("TradingLib:", tradingLibAddress);

    // Phase 3: Other libraries required by TradingCore and TradingCoreViews
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
        [libAddr("CleanupLib")]: cleanupLib,
        [libAddr("ConfigLib")]: configLib,
        [libAddr("DustLib")]: dustLib,
        [libAddr("FlashLoanCheck")]: flashLoanCheck,
        [libAddr("FundingLib")]: fundingLib,
        [libAddr("HealthLib")]: healthLib,
        [libAddr("PositionTriggersLib")]: positionTriggersLib,
        [libAddr("RateLimitLib")]: rateLimitLib,
        [libAddr("TradingContextLib")]: tradingContextLib,
        [libAddr("TradingLib")]: tradingLibAddress,
        [libAddr("WithdrawLib")]: withdrawLib,
    };

    const TradingCore = await ethers.getContractFactory("TradingCore", {
        libraries: tradingCoreLibraries,
    });
    const tradingProxy = await upgrades.deployProxy(TradingCore, [admin, usdcAddress, treasury], {
        kind: "uups",
        initializer: "initialize",
        unsafeAllowLinkedLibraries: true,
        ...heavyTxOverrides,
    });
    await tradingProxy.waitForDeployment();
    const tradingCore = await tradingProxy.getAddress();
    console.log("TradingCore (proxy):", tradingCore);

    const TradingCoreViews = await ethers.getContractFactory("TradingCoreViews");
    const tradingViews = await TradingCoreViews.deploy(...(heavyOverrides ? [heavyOverrides] : []));
    await tradingViews.waitForDeployment();
    const tradingCoreViews = await tradingViews.getAddress();
    await withRetryUnderpriced(normalOverrides, (o) =>
        tradingViews.initialize(tradingCore, vaultCore, oracleAggregator, o ?? {}),
    );
    console.log("TradingCoreViews:", tradingCoreViews);

    const DividendKeeper = await ethers.getContractFactory("DividendKeeper");
    const dividendKeeperProxy = await withRetryUnderpriced(
        normalOverrides,
        (o) =>
            upgrades.deployProxy(DividendKeeper, [admin, dividendManager], {
                kind: "uups",
                initializer: "initialize",
                ...(o ? { txOverrides: o } : {}),
            }),
        "DividendKeeper",
    );
    await dividendKeeperProxy.waitForDeployment();
    const dividendKeeper = await dividendKeeperProxy.getAddress();
    console.log("DividendKeeper (proxy):", dividendKeeper);

    console.log("\n--- Wiring contracts ---");

    const vault = await ethers.getContractAt("VaultCore", vaultCore);
    await withRetryUnderpriced(normalOverrides, (o) => vault.setTradingCore(tradingCore, o ?? {}));
    console.log("VaultCore.setTradingCore ok");

    const pt = await ethers.getContractAt("PositionToken", positionToken);
    await withRetryUnderpriced(normalOverrides, (o) => pt.setTradingCore(tradingCore, o ?? {}));
    console.log("PositionToken.setTradingCore ok");

    const tc = await ethers.getContractAt("TradingCore", tradingCore);
    await withRetryUnderpriced(normalOverrides, (o) =>
        tc.setContracts(vaultCore, oracleAggregator, positionToken, o ?? {}),
    );
    console.log("TradingCore.setContracts ok");
    await withRetryUnderpriced(normalOverrides, (o) =>
        tc.setRWAContracts(marketCalendar, dividendManager, complianceManager, o ?? {}),
    );
    console.log("TradingCore.setRWAContracts ok");
    await withRetryUnderpriced(normalOverrides, (o) => tc.setTradingViews(tradingCoreViews, o ?? {}));
    console.log("TradingCore.setTradingViews ok");
    
    await withRetryUnderpriced(normalOverrides, (o) => tc.setCollateralRegistry(collateralRegistry, o ?? {}));
    console.log("TradingCore.setCollateralRegistry ok");

    const TRADING_CORE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TRADING_CORE_ROLE"));

    // CollateralRegistry: let TradingCore record deposits/withdrawals for exposure caps.
    const cr = await ethers.getContractAt("CollateralRegistry", collateralRegistry);
    await withRetryUnderpriced(normalOverrides, (o) => cr.grantRole(TRADING_CORE_ROLE, tradingCore, o ?? {}));
    console.log("CollateralRegistry: TradingCore granted TRADING_CORE_ROLE");

    // ReferralRegistry: TradingCore records per-trade volume via recordReferralVolume (onlyTradingCore).
    const rr = await ethers.getContractAt("ReferralRegistry", referralRegistry);
    await withRetryUnderpriced(normalOverrides, (o) => rr.grantRole(TRADING_CORE_ROLE, tradingCore, o ?? {}));
    console.log("ReferralRegistry: TradingCore granted TRADING_CORE_ROLE");

    // Wire the referral registry into TradingCore. `setReferralRegistry` enforces a
    // 48h staged timelock, so we always propose here. On local networks we fast-forward
    // and apply immediately; on live networks an operator runs the apply after the delay.
    await withRetryUnderpriced(normalOverrides, (o) => tc.proposeReferralRegistry(referralRegistry, o ?? {}));
    console.log("TradingCore.proposeReferralRegistry ok");
    const net = await ethers.provider.getNetwork();
    if (net.chainId === 31337n) {
        const REFERRAL_REGISTRY_TIMELOCK = 48 * 60 * 60;
        await ethers.provider.send("evm_increaseTime", [REFERRAL_REGISTRY_TIMELOCK + 1]);
        await ethers.provider.send("evm_mine", []);
        await tc.setReferralRegistry(referralRegistry);
        console.log("TradingCore.setReferralRegistry ok (local fast-forward)");
    } else {
        console.log(
            "TradingCore.setReferralRegistry pending: run after 48h ->",
            `tc.setReferralRegistry(${referralRegistry})`,
        );
    }

    const dm = await ethers.getContractAt("DividendManager", dividendManager);
    await withRetryUnderpriced(normalOverrides, (o) => dm.setTradingCore(tradingCore, o ?? {}));
    console.log("DividendManager.setTradingCore ok");

    const oa = await ethers.getContractAt("OracleAggregator", oracleAggregator);
    await withRetryUnderpriced(normalOverrides, (o) => oa.setMarketCalendar(marketCalendar, o ?? {}));
    console.log("OracleAggregator.setMarketCalendar ok");
    await withRetryUnderpriced(normalOverrides, (o) => oa.registerPausable(tradingCore, o ?? {}));
    await withRetryUnderpriced(normalOverrides, (o) => oa.registerPausable(vaultCore, o ?? {}));
    console.log("OracleAggregator.registerPausable ok");

    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    await withRetryUnderpriced(normalOverrides, (o) => oa.grantRole(OPERATOR_ROLE, admin, o ?? {}));
    console.log("OracleAggregator: admin granted OPERATOR_ROLE");
    await withRetryUnderpriced(normalOverrides, (o) => tc.grantRole(OPERATOR_ROLE, admin, o ?? {}));
    console.log("TradingCore: admin granted OPERATOR_ROLE");

    console.log("\n--- Deployment complete ---\n");

    return {
        usdcIsMock: !!mockUsdcAddress,
        mockUsdc: mockUsdcAddress,
        pythIsMock: !!mockPythAddress,
        mockPyth: mockPythAddress,
        marketCalendar,
        dividendManager,
        complianceManager,
        oracleAggregator,
        vaultCore,
        positionToken,
        tradingCore,
        tradingCoreViews,
        dividendKeeper,
        usdc: usdcAddress,
        pyth: pythAddress,
        collateralRegistry,
        copyRegistry,
        referralRegistry,
    };
}
