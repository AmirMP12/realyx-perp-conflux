import { ethers } from "hardhat";
import { CollateralRegistry } from "../typechain";

/**
 * Registers alternative collateral tokens on the CollateralRegistry.
 *
 * The on-chain `registerToken` signature (see contracts/core/CollateralRegistry.sol):
 *   registerToken(
 *     address token,
 *     uint16  baseHaircutBps,
 *     uint16  liquidationHaircutBps,
 *     uint16  maxHaircutBps,
 *     uint16  utilizationSlopeBps,
 *     uint16  volatilityAdderBps,
 *     uint256 maxProtocolExposure,   // USDC-equivalent cap (6 decimals); 0 = uncapped
 *     address oracleFeed,            // OracleAggregator market/collection used for pricing
 *     uint8   decimals
 *   )
 *
 * `oracleFeed` must be non-zero and already registered on the OracleAggregator,
 * otherwise valuation reverts with InvalidOraclePrice / ZeroAddress.
 */
async function main() {
    const registryAddress = process.env.COLLATERAL_REGISTRY;
    if (!registryAddress) {
        throw new Error("Please set COLLATERAL_REGISTRY in your environment variables");
    }

    const usdcAddress = process.env.USDC_ADDRESS;
    const axcnhAddress = process.env.AXCNH_ADDRESS;
    if (!usdcAddress || !axcnhAddress) {
        throw new Error("Please set USDC_ADDRESS and AXCNH_ADDRESS in your environment variables");
    }

    const usdcOracleFeed = process.env.USDC_PRICE_FEED;
    const axcnhOracleFeed = process.env.AXCNH_PRICE_FEED;
    if (!usdcOracleFeed || !axcnhOracleFeed) {
        throw new Error(
            "Please set USDC_PRICE_FEED and AXCNH_PRICE_FEED (OracleAggregator market addresses) in your environment variables",
        );
    }

    const [deployer] = await ethers.getSigners();
    console.log(`Registering collaterals with deployer ${deployer.address}...`);

    const registry = (await ethers.getContractAt(
        "CollateralRegistry",
        registryAddress,
    )) as unknown as CollateralRegistry;

    // Register USDC as an alternative collateral (6 decimals, low risk).
    // USDT0 is the protocol's main settlement asset and is NOT registered here.
    console.log(`Registering USDC (${usdcAddress})...`);
    let tx = await registry.registerToken(
        usdcAddress,
        200, // baseHaircutBps        = 2%
        500, // liquidationHaircutBps = 5%
        1000, // maxHaircutBps         = 10%
        50, // utilizationSlopeBps    = +0.5% per 100% utilization
        100, // volatilityAdderBps     = +1% when oracle confidence is wide
        0, // maxProtocolExposure      = uncapped
        usdcOracleFeed,
        6, // decimals
    );
    await tx.wait();
    console.log("USDC registered successfully.");

    // Register AxCNH (18 decimals, slightly higher risk)
    console.log(`Registering AxCNH (${axcnhAddress})...`);
    tx = await registry.registerToken(
        axcnhAddress,
        300, // baseHaircutBps        = 3%
        700, // liquidationHaircutBps = 7%
        1200, // maxHaircutBps         = 12%
        75, // utilizationSlopeBps    = +0.75% per 100% utilization
        150, // volatilityAdderBps     = +1.5% when oracle confidence is wide
        0, // maxProtocolExposure      = uncapped
        axcnhOracleFeed,
        18, // decimals
    );
    await tx.wait();
    console.log("AxCNH registered successfully.");

    console.log("All collaterals registered!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
