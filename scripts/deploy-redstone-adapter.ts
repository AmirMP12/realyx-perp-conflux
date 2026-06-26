import { ethers, network } from "hardhat";
import { loadDeployment } from "./write-deployment";

/**
 * Deploy the RedStone secondary price source and wire it into the
 * OracleAggregator as an independent cross-check (Pyth stays primary).
 *
 * Steps:
 *   1. Deploy `RedStoneAdapter(admin)`.
 *   2. Configure per-market RedStone feeds on the adapter (`setFeed`).
 *   3. On the OracleAggregator: `setSecondarySource`, `setCrossSourceMaxDeviationBps`,
 *      and `setCrossCheckEnabled(market, true)` per market.
 *   4. Grant `REDSTONE_KEEPER_ROLE` to the keeper that will push prices.
 *
 * Env:
 *   DEPLOYED_ORACLE_AGGREGATOR   OracleAggregator address (falls back to deployment/<network>.json)
 *   REDSTONE_ADMIN               adapter admin (default: deployer)
 *   REDSTONE_KEEPER              address granted REDSTONE_KEEPER_ROLE (default: deployer)
 *   CROSS_SOURCE_MAX_DEVIATION_BPS  deviation guard in bps (default: 200 = 2%)
 *   MARKET_ADDRESSES             comma-separated market addresses
 *   REDSTONE_FEED_SYMBOLS        comma-separated RedStone feed symbols, e.g. "BTC,ETH,TSLA"
 *   REDSTONE_FEED_DECIMALS       decimals per RedStone value (default: 8 for all)
 *   REDSTONE_MAX_STALENESS       seconds before a cached secondary price is invalid (default: 120)
 *
 * NOTE: The production adapter trusts the `redstone-primary-prod` data service
 *       (3-of-N unique signers). The keeper must push with a real RedStone
 *       payload (see scripts/redstone-push.ts).
 */

const REDSTONE_KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REDSTONE_KEEPER_ROLE"));

function envList(name: string): string[] {
    return (process.env[name] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function resolveOracleAddress(): string {
    const fromEnv = process.env.DEPLOYED_ORACLE_AGGREGATOR?.trim();
    if (fromEnv) return fromEnv;
    const dep = loadDeployment(network.name);
    const addr = dep?.contracts?.oracleAggregator;
    if (!addr) {
        throw new Error(
            "OracleAggregator address not found. Set DEPLOYED_ORACLE_AGGREGATOR or run the main deploy first.",
        );
    }
    return addr;
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const admin = process.env.REDSTONE_ADMIN?.trim() || deployer.address;
    const keeper = process.env.REDSTONE_KEEPER?.trim() || deployer.address;
    const maxDevBps = BigInt(process.env.CROSS_SOURCE_MAX_DEVIATION_BPS || "200");
    const maxStaleness = Number(process.env.REDSTONE_MAX_STALENESS || "120");

    const markets = envList("MARKET_ADDRESSES");
    const symbols = envList("REDSTONE_FEED_SYMBOLS");
    if (markets.length === 0 || markets.length !== symbols.length) {
        throw new Error(
            `MARKET_ADDRESSES (${markets.length}) and REDSTONE_FEED_SYMBOLS (${symbols.length}) must be non-empty and equal length`,
        );
    }
    const decimalsList = envList("REDSTONE_FEED_DECIMALS");
    const decimalsFor = (i: number) => Number(decimalsList[i] ?? decimalsList[0] ?? "8");

    const oracleAddr = resolveOracleAddress();
    console.log(`Network: ${network.name}`);
    console.log(`OracleAggregator: ${oracleAddr}`);
    console.log(`Adapter admin: ${admin}  keeper: ${keeper}`);

    // 1. Deploy adapter
    const Adapter = await ethers.getContractFactory("RedStoneAdapter");
    const adapter = await Adapter.deploy(admin);
    await adapter.waitForDeployment();
    const adapterAddr = await adapter.getAddress();
    console.log(`RedStoneAdapter deployed: ${adapterAddr}`);

    // 2. Configure feeds on the adapter
    for (let i = 0; i < markets.length; i++) {
        const fid = ethers.encodeBytes32String(symbols[i]!);
        const tx = await adapter.setFeed(markets[i]!, fid, decimalsFor(i), maxStaleness);
        await tx.wait();
        console.log(
            `  setFeed ${markets[i]} -> ${symbols[i]} (decimals ${decimalsFor(i)}, staleness ${maxStaleness}s)`,
        );
    }

    // 3. Grant keeper role (if distinct from admin, who already has it)
    if (keeper.toLowerCase() !== admin.toLowerCase()) {
        const tx = await adapter.grantRole(REDSTONE_KEEPER_ROLE, keeper);
        await tx.wait();
        console.log(`  granted REDSTONE_KEEPER_ROLE to ${keeper}`);
    }

    // 4. Wire into the aggregator
    const oracle = await ethers.getContractAt("OracleAggregator", oracleAddr);
    await (await oracle.setSecondarySource(adapterAddr)).wait();
    console.log(`OracleAggregator.setSecondarySource -> ${adapterAddr}`);
    await (await oracle.setCrossSourceMaxDeviationBps(maxDevBps)).wait();
    console.log(`OracleAggregator.setCrossSourceMaxDeviationBps -> ${maxDevBps} bps`);
    for (const market of markets) {
        await (await oracle.setCrossCheckEnabled(market, true)).wait();
        console.log(`  crossCheckEnabled(${market}) = true`);
    }

    console.log("\nDone. Next: run scripts/redstone-push.ts on a schedule to keep the secondary fresh.");
    console.log(`Set REDSTONE_ADAPTER=${adapterAddr} for the keeper helper.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
