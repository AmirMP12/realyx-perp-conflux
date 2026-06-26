import { ethers, network } from "hardhat";
import { requestRedstonePayload } from "@redstone-finance/sdk";

/**
 * Keeper helper: fetch a real RedStone-signed payload from the public gateways
 * and push it into the RedStoneAdapter cache so the OracleAggregator's
 * cross-source check has a fresh secondary price.
 *
 * RedStone's pull model appends the signed payload to the END of the tx
 * calldata; the adapter (a `PrimaryProdDataServiceConsumerBase`) verifies the
 * signatures, the 3-of-N unique-signer threshold, and timestamp freshness
 * on-chain before caching the value.
 *
 * Env:
 *   REDSTONE_ADAPTER         deployed RedStoneAdapter address (required)
 *   MARKET_ADDRESSES         comma-separated market addresses to refresh (required)
 *   REDSTONE_FEED_SYMBOLS    comma-separated RedStone feed symbols, same order/length (required)
 *   REDSTONE_UNIQUE_SIGNERS  unique signers to request (default 3, must be >= on-chain threshold)
 *
 * Run on a schedule (cron / PM2 / k8s CronJob) tighter than the adapter's
 * configured maxStaleness, e.g. every 60s for a 120s staleness window.
 */

const DATA_SERVICE_ID = "redstone-primary-prod";

// Authorised signers for `redstone-primary-prod`, mirroring
// PrimaryProdDataServiceConsumerBase.getAuthorisedSignerIndex on-chain.
const PRIMARY_PROD_SIGNERS = [
    "0x8BB8F32Df04c8b654987DAaeD53D6B6091e3B774",
    "0xdEB22f54738d54976C4c0fe5ce6d408E40d88499",
    "0x51Ce04Be4b3E32572C4Ec9135221d0691Ba7d202",
    "0xDD682daEC5A90dD295d14DA4b0bec9281017b5bE",
    "0x9c5AE89C4Af6aA32cE58588DBaF90d18a855B6de",
];

function envList(name: string): string[] {
    return (process.env[name] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function requireEnv(name: string): string {
    const v = process.env[name]?.trim();
    if (!v) throw new Error(`${name} is required`);
    return v;
}

async function main() {
    const adapterAddr = requireEnv("REDSTONE_ADAPTER");
    const markets = envList("MARKET_ADDRESSES");
    const symbols = envList("REDSTONE_FEED_SYMBOLS");
    const uniqueSigners = Number(process.env.REDSTONE_UNIQUE_SIGNERS || "3");

    if (markets.length === 0 || markets.length !== symbols.length) {
        throw new Error(
            `MARKET_ADDRESSES (${markets.length}) and REDSTONE_FEED_SYMBOLS (${symbols.length}) must be non-empty and equal length`,
        );
    }

    const code = await ethers.provider.getCode(adapterAddr);
    if (!code || code === "0x") throw new Error(`No contract at REDSTONE_ADAPTER=${adapterAddr}`);

    const [keeper] = await ethers.getSigners();
    const adapter = await ethers.getContractAt("RedStoneAdapter", adapterAddr);

    // De-dupe symbols for the gateway request; the on-chain payload carries each
    // feed once and the adapter resolves per-market feed ids from storage.
    const dataPackagesIds = Array.from(new Set(symbols));
    console.log(`[${network.name}] requesting RedStone payload for: ${dataPackagesIds.join(", ")}`);

    const payloadHex = await requestRedstonePayload({
        dataServiceId: DATA_SERVICE_ID,
        dataPackagesIds,
        uniqueSignersCount: uniqueSigners,
        authorizedSigners: PRIMARY_PROD_SIGNERS,
    });
    const payload = payloadHex.startsWith("0x") ? payloadHex.slice(2) : payloadHex;

    // Append the signed payload to the pushPrices calldata.
    const fnData = adapter.interface.encodeFunctionData("pushPrices", [markets]);
    const tx = await keeper.sendTransaction({
        to: adapterAddr,
        data: fnData + payload,
    });
    console.log(`pushPrices tx: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`mined in block ${rc?.blockNumber}. Refreshed ${markets.length} market(s).`);

    for (let i = 0; i < markets.length; i++) {
        const [price, , , valid] = await adapter.getPrice(markets[i]!);
        console.log(`  ${symbols[i]} (${markets[i]}): ${ethers.formatUnits(price, 18)} valid=${valid}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
