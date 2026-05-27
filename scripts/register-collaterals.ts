import { ethers } from "hardhat";
import { CollateralRegistry } from "../typechain";

async function main() {
    const registryAddress = process.env.COLLATERAL_REGISTRY;
    if (!registryAddress) {
        throw new Error("Please set COLLATERAL_REGISTRY in your environment variables");
    }

    const usdt0Address = process.env.USDT0_ADDRESS;
    const axcnhAddress = process.env.AXCNH_ADDRESS;

    if (!usdt0Address || !axcnhAddress) {
        throw new Error("Please set USDT0_ADDRESS and AXCNH_ADDRESS in your environment variables");
    }

    const [deployer] = await ethers.getSigners();
    console.log(`Registering collaterals with deployer ${deployer.address}...`);

    const registry = await ethers.getContractAt("CollateralRegistry", registryAddress) as CollateralRegistry;

    // Register USDT0
    console.log(`Registering USDT0 (${usdt0Address})...`);
    let tx = await registry.registerCollateral(usdt0Address, {
        priceFeed: process.env.USDT0_PRICE_FEED || ethers.ZeroAddress,
        decimals: 6,
        targetUsdcPrecision: 6,
        baseHaircutBps: 200, // 2%
        maxDynamicHaircutBps: 1000, // 10%
        enabled: true
    });
    await tx.wait();
    console.log("USDT0 registered successfully.");

    // Register AxCNH
    console.log(`Registering AxCNH (${axcnhAddress})...`);
    tx = await registry.registerCollateral(axcnhAddress, {
        priceFeed: process.env.AXCNH_PRICE_FEED || ethers.ZeroAddress,
        decimals: 18,
        targetUsdcPrecision: 6,
        baseHaircutBps: 300, // 3%
        maxDynamicHaircutBps: 1200, // 12%
        enabled: true
    });
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
