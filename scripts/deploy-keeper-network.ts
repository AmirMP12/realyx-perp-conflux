import { ethers, upgrades, network } from "hardhat";
import { loadDeployment, updateDeploymentContracts } from "./write-deployment";

/**
 * Deploy the decentralized `KeeperNetwork` (UUPS proxy).
 *
 * The KeeperNetwork holds `KEEPER_ROLE` (and optionally `LIQUIDATOR_ROLE`) on
 * TradingCore and re-exposes order execution, on-chain trigger self-execution,
 * and liquidations permissionlessly with native reward bounties. Wiring the
 * roles + funding is done by `setup-keeper-network.ts` after this deploy.
 *
 * Env:
 *   DEPLOYED_TRADING_CORE        TradingCore proxy (falls back to deployment/<network>.json)
 *   KEEPER_NETWORK_ADMIN         admin / governance (default: deployer)
 *   KEEPER_NETWORK_USDC          USDC token for liquidation reward forwarding
 *                                (falls back to deployment usdt0)
 *   KEEPER_NETWORK_PERMISSIONLESS  "true" = anyone can execute w/o staking (default: true)
 *   KEEPER_NETWORK_MIN_STAKE     min native stake (wei) when not permissionless (default: 0)
 */

function resolveFromDeployment(key: "tradingCore" | "usdt0"): string | undefined {
    const dep = loadDeployment(network.name);
    return dep?.contracts?.[key];
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const admin = process.env.KEEPER_NETWORK_ADMIN?.trim() || deployer.address;

    const tradingCore = process.env.DEPLOYED_TRADING_CORE?.trim() || resolveFromDeployment("tradingCore");
    if (!tradingCore) {
        throw new Error("Set DEPLOYED_TRADING_CORE or run the main deploy first (deployment/<network>.json).");
    }

    const usdc =
        process.env.KEEPER_NETWORK_USDC?.trim() || process.env.USDT0_ADDRESS?.trim() || resolveFromDeployment("usdt0");
    if (!usdc) {
        throw new Error("Set KEEPER_NETWORK_USDC (USDC/collateral token used for liquidation rewards).");
    }

    const permissionless = (process.env.KEEPER_NETWORK_PERMISSIONLESS ?? "true").toLowerCase() !== "false";
    const minStake = BigInt(process.env.KEEPER_NETWORK_MIN_STAKE ?? "0");

    console.log(`Network: ${network.name}`);
    console.log(`Admin: ${admin}`);
    console.log(`TradingCore: ${tradingCore}`);
    console.log(`USDC (reward token): ${usdc}`);
    console.log(`Permissionless: ${permissionless}  minStake: ${minStake} wei`);

    const KeeperNetwork = await ethers.getContractFactory("KeeperNetwork");
    const proxy = await upgrades.deployProxy(KeeperNetwork, [admin, tradingCore, usdc, permissionless, minStake], {
        kind: "uups",
        initializer: "initialize",
    });
    await proxy.waitForDeployment();

    const proxyAddress = await proxy.getAddress();
    const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    // Persist the proxy address into deployment/<network>.json so that
    // setup-keeper-network.ts and decentralized-keeper-bot.ts can resolve it
    // through `loadDeployment` (their documented fallback) without requiring
    // KEEPER_NETWORK_ADDRESS to be set by hand.
    const filePath = updateDeploymentContracts(network.name, { keeperNetwork: proxyAddress });

    console.log("\nKeeperNetwork deployed.");
    console.log(`  Proxy:          ${proxyAddress}`);
    console.log(`  Implementation: ${implAddress}`);
    console.log(`  Saved to:       ${filePath}`);
    console.log("\nNext steps:");
    console.log(`  1. set KEEPER_NETWORK_ADDRESS=${proxyAddress}`);
    console.log("  2. run scripts/setup-keeper-network.ts to grant roles + fund rewards");
    console.log("  3. run scripts/decentralized-keeper-bot.ts to start executing");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
