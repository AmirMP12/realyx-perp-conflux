import { ethers, network } from "hardhat";
import { loadDeployment } from "./write-deployment";

/**
 * Wire the deployed `KeeperNetwork` into TradingCore and fund its reward pool.
 *
 * Performs (idempotently):
 *   1. Grant KEEPER_ROLE to the KeeperNetwork on TradingCore (order + trigger execution).
 *   2. Grant LIQUIDATOR_ROLE to the KeeperNetwork on TradingCore (liquidations).
 *   3. Enable permissionless liquidation on the core as a backstop.
 *   4. Set native bounties on the KeeperNetwork.
 *   5. Fund the KeeperNetwork reward pool with native tokens.
 *
 * Env:
 *   KEEPER_NETWORK_ADDRESS       deployed KeeperNetwork proxy (required)
 *   DEPLOYED_TRADING_CORE        TradingCore proxy (falls back to deployment/<network>.json)
 *   KEEPER_ORDER_BOUNTY          native bounty per order (wei, default: 0)
 *   KEEPER_TRIGGER_BOUNTY        native bounty per processed trigger (wei, default: 0)
 *   KEEPER_LIQUIDATION_BOUNTY    native bounty per liquidation (wei, default: 0)
 *   KEEPER_REWARD_FUNDING        native funding for the reward pool (wei, default: 0)
 *   KEEPER_SKIP_PERMISSIONLESS_LIQ  "true" to skip enabling the core permissionless flag
 */

const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
const LIQUIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("LIQUIDATOR_ROLE"));

async function assertCode(address: string, label: string): Promise<void> {
    const code = await ethers.provider.getCode(address);
    if (!code || code === "0x") {
        const { chainId } = await ethers.provider.getNetwork();
        throw new Error(`${label} at ${address} has no bytecode on chainId ${chainId}.`);
    }
}

async function grantIfMissing(tc: any, role: string, label: string, to: string): Promise<void> {
    if (await tc.hasRole(role, to)) {
        console.log(`  ${label}: already granted to ${to}`);
        return;
    }
    console.log(`  ${label}: granting to ${to} ...`);
    const tx = await tc.grantRole(role, to);
    await tx.wait();
    console.log(`    tx=${tx.hash}`);
}

async function main() {
    const keeperNetworkAddr = process.env.KEEPER_NETWORK_ADDRESS?.trim();
    if (!keeperNetworkAddr) throw new Error("KEEPER_NETWORK_ADDRESS is required.");

    const tradingCoreAddr =
        process.env.DEPLOYED_TRADING_CORE?.trim() || loadDeployment(network.name)?.contracts?.tradingCore;
    if (!tradingCoreAddr) throw new Error("Set DEPLOYED_TRADING_CORE or run the main deploy first.");

    await assertCode(keeperNetworkAddr, "KeeperNetwork");
    await assertCode(tradingCoreAddr, "TradingCore");

    const tc = await ethers.getContractAt("TradingCore", tradingCoreAddr);
    const kn = await ethers.getContractAt("KeeperNetwork", keeperNetworkAddr);

    console.log(`Network: ${network.name}`);
    console.log(`TradingCore: ${tradingCoreAddr}`);
    console.log(`KeeperNetwork: ${keeperNetworkAddr}`);

    console.log("\n[1/5] Roles on TradingCore");
    await grantIfMissing(tc, KEEPER_ROLE, "KEEPER_ROLE", keeperNetworkAddr);
    await grantIfMissing(tc, LIQUIDATOR_ROLE, "LIQUIDATOR_ROLE", keeperNetworkAddr);

    console.log("\n[2/5] Permissionless liquidation backstop on core");
    if ((process.env.KEEPER_SKIP_PERMISSIONLESS_LIQ ?? "").toLowerCase() === "true") {
        console.log("  skipped (KEEPER_SKIP_PERMISSIONLESS_LIQ=true)");
    } else {
        try {
            const tx = await tc.setPermissionlessLiquidation(true);
            await tx.wait();
            console.log(`  enabled. tx=${tx.hash}`);
        } catch (e) {
            console.warn(`  could not enable (continuing): ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    console.log("\n[3/5] Sync oracle on KeeperNetwork");
    try {
        const tx = await kn.syncOracle();
        await tx.wait();
        console.log(`  synced. tx=${tx.hash}`);
    } catch (e) {
        console.warn(`  sync skipped: ${e instanceof Error ? e.message : String(e)}`);
    }

    console.log("\n[4/5] Bounties");
    const orderBounty = BigInt(process.env.KEEPER_ORDER_BOUNTY ?? "0");
    const triggerBounty = BigInt(process.env.KEEPER_TRIGGER_BOUNTY ?? "0");
    const liquidationBounty = BigInt(process.env.KEEPER_LIQUIDATION_BOUNTY ?? "0");
    {
        const tx = await kn.setBounties(orderBounty, triggerBounty, liquidationBounty);
        await tx.wait();
        console.log(
            `  order=${orderBounty} trigger=${triggerBounty} liquidation=${liquidationBounty} wei tx=${tx.hash}`,
        );
    }

    console.log("\n[5/5] Reward funding");
    const funding = BigInt(process.env.KEEPER_REWARD_FUNDING ?? "0");
    if (funding > 0n) {
        const tx = await kn.fundRewards({ value: funding });
        await tx.wait();
        console.log(`  funded ${funding} wei. pool=${(await kn.rewardPool()).toString()} tx=${tx.hash}`);
    } else {
        console.log("  no funding (KEEPER_REWARD_FUNDING=0)");
    }

    console.log("\nSetup complete.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
