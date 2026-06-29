import "dotenv/config";
import { ethers } from "hardhat";
import { loadDeployment } from "./write-deployment";

/**
 * Inspect (and optionally update) per-market oracle config on `OracleAggregator`.
 *
 * Why: orders can revert at execution time with `InsufficientConfidence()`
 * (0x40eba60f) when a market's live Pyth confidence band is wider than the
 * configured `maxConfidence`, or with TWAP/deviation guards while the TWAP is
 * still warming up. This script shows the current config + live feed state and
 * suggests a `maxConfidence`, then can apply it.
 *
 * `maxConfidence` is a RELATIVE cap: the max acceptable Pyth confidence as a
 * fraction of price in BASIS POINTS (e.g. 50 = 0.50%, 100 = 1%). This is
 * price-scale independent, so it works for high-priced assets like BTC.
 *
 * Changing `maxConfidence`/`maxStaleness` while keeping the SAME `feedId` is
 * applied IMMEDIATELY by `setPythFeed` (only a feed-id *rotation* is timelocked),
 * so this is a one-tx operator action.
 *
 * Usage (env-driven, since `hardhat run` doesn't forward CLI args):
 *   # read-only inspection (default)
 *   ORACLE_MARKETS=0xMarketA,0xMarketB \
 *     npx hardhat run scripts/set-oracle-config.ts --network confluxTestnet
 *
 *   # apply an explicit maxConfidence in BPS of price to each market (50 = 0.5%)
 *   ORACLE_MARKETS=0xMarketA ORACLE_SET=true ORACLE_MAX_CONFIDENCE=50 \
 *     npx hardhat run scripts/set-oracle-config.ts --network confluxTestnet
 *
 *   # apply the auto-suggested value (live confidence in bps x multiplier)
 *   ORACLE_MARKETS=0xMarketA ORACLE_SET=true ORACLE_AUTO=true ORACLE_MAX_CONFIDENCE_MULTIPLIER=3 \
 *     npx hardhat run scripts/set-oracle-config.ts --network confluxTestnet
 *
 * Optional:
 *   ORACLE_AGGREGATOR_ADDRESS  override the deployment-file address
 *   ORACLE_MAX_STALENESS       override staleness (seconds); else preserve current
 */

const ORACLE_ABI = [
    "function getOracleConfig(address collection) external view returns (bytes32 feedId, uint256 maxStaleness, uint256 minPrice, uint256 maxPrice)",
    "function isOracleHealthy(address collection) external view returns (bool healthy, string reason)",
    "function pyth() external view returns (address)",
    "function setPythFeed(address collection, bytes32 feedId, uint256 maxStaleness, uint64 maxConfidence) external",
];

const PYTH_ABI = [
    "function getPriceUnsafe(bytes32 id) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime) price)",
];

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const UINT64_MAX = 2n ** 64n - 1n;

/** Replicates OracleAggregator._normalizePythPrice / _normalizePythConfidence (1e18 scale). */
function normalize(raw: bigint, expo: number): bigint {
    if (raw <= 0n) return 0n;
    const decimalDiff = 18 + expo;
    if (decimalDiff > 30 || decimalDiff < -30) throw new Error(`expo out of range: ${expo}`);
    if (decimalDiff >= 0) return raw * 10n ** BigInt(decimalDiff);
    const scaled = raw / 10n ** BigInt(-decimalDiff);
    return scaled === 0n ? 1n : scaled;
}

function parseMarkets(): string[] {
    const csv = process.env.ORACLE_MARKETS;
    if (!csv) throw new Error("Set ORACLE_MARKETS=0xMarketA,0xMarketB");
    const list = csv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    for (const m of list) {
        if (!ethers.isAddress(m)) throw new Error(`Invalid market address: ${m}`);
    }
    if (list.length === 0) throw new Error("ORACLE_MARKETS is empty");
    return list;
}

async function main() {
    const networkName = process.env.HARDHAT_NETWORK || "confluxTestnet";
    const deployment = loadDeployment(networkName);
    const oracleAddress =
        process.env.ORACLE_AGGREGATOR_ADDRESS ||
        process.env.DEPLOYED_ORACLE_AGGREGATOR ||
        deployment?.contracts?.oracleAggregator;
    if (!oracleAddress) {
        throw new Error("Set ORACLE_AGGREGATOR_ADDRESS or provide deployment/<network>.json with oracleAggregator");
    }

    const markets = parseMarkets();
    const doSet = (process.env.ORACLE_SET ?? "").toLowerCase() === "true";
    const auto = (process.env.ORACLE_AUTO ?? "").toLowerCase() === "true";
    const multiplier = BigInt(Math.max(1, Number(process.env.ORACLE_MAX_CONFIDENCE_MULTIPLIER ?? "3")));
    const explicitMaxConf = process.env.ORACLE_MAX_CONFIDENCE ? BigInt(process.env.ORACLE_MAX_CONFIDENCE) : null;
    const stalenessOverride = process.env.ORACLE_MAX_STALENESS ? BigInt(process.env.ORACLE_MAX_STALENESS) : null;

    const [signer] = await ethers.getSigners();
    const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, signer);
    const pythAddress: string = await oracle.pyth();
    const pyth = new ethers.Contract(pythAddress, PYTH_ABI, signer);

    console.log(`network=${networkName}`);
    console.log(`oracleAggregator=${oracleAddress}`);
    console.log(`pyth=${pythAddress}`);
    console.log(`signer=${await signer.getAddress()}`);
    console.log(`mode=${doSet ? "SET" : "INSPECT (read-only)"}\n`);

    for (const market of markets) {
        console.log(`── market ${market} ──────────────────────────────`);
        let feedId: string;
        let maxStaleness: bigint;
        let minPrice: bigint;
        let maxPrice: bigint;
        try {
            [feedId, maxStaleness, minPrice, maxPrice] = await oracle.getOracleConfig(market);
        } catch (err) {
            console.log(`  getOracleConfig failed: ${err instanceof Error ? err.message : String(err)}\n`);
            continue;
        }

        if (!feedId || feedId === ZERO_BYTES32) {
            console.log("  NOT CONFIGURED (no feedId). Use setPythFeed to register this market first.\n");
            continue;
        }

        console.log(`  feedId=${feedId}`);
        console.log(`  maxStaleness=${maxStaleness}s  minPrice=${minPrice}  maxPrice=${maxPrice}`);

        try {
            const [healthy, reason] = await oracle.isOracleHealthy(market);
            console.log(`  health=${healthy ? "OK" : `UNHEALTHY (${reason})`}`);
        } catch (err) {
            console.log(`  isOracleHealthy failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        let suggested: bigint | null = null;
        try {
            const p = await pyth.getPriceUnsafe(feedId);
            const rawPrice = BigInt(p.price);
            const rawConf = BigInt(p.conf);
            const expo = Number(p.expo);
            const publishTime = BigInt(p.publishTime);
            const nowSec = BigInt(Math.floor(Date.now() / 1000));

            const normPrice = normalize(rawPrice, expo);
            const normConf = normalize(rawConf, expo);
            const confBps = normPrice > 0n ? (normConf * 10000n) / normPrice : 0n;
            const confPct = Number(confBps) / 100;
            const ageSec = nowSec - publishTime;

            console.log(`  live pyth: rawPrice=${rawPrice} rawConf=${rawConf} expo=${expo} age=${ageSec}s`);
            console.log(
                `  normalized(1e18): price=${normPrice} confidence=${normConf} (${confPct.toFixed(4)}% of price = ${confBps} bps)`,
            );

            // maxConfidence is now a RELATIVE cap in BPS of price. Suggest the
            // live confidence (in bps) times a safety multiplier, with a floor of
            // 1 bps so the contract's `maxConfidence > 0` requirement holds.
            suggested = confBps * multiplier;
            if (suggested < 1n) suggested = 1n;
            if (suggested > UINT64_MAX) suggested = UINT64_MAX;
            console.log(`  suggested maxConfidence (x${multiplier}) = ${suggested} bps`);
        } catch (err) {
            console.log(`  pyth.getPriceUnsafe failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (!doSet) {
            console.log("");
            continue;
        }

        // Resolve the value to write (interpreted as BPS of price).
        let newMaxConf: bigint | null = explicitMaxConf;
        if (newMaxConf == null && auto) newMaxConf = suggested;
        if (newMaxConf == null) {
            console.log("  SET skipped: provide ORACLE_MAX_CONFIDENCE=<bps> or ORACLE_AUTO=true.\n");
            continue;
        }
        if (newMaxConf <= 0n) {
            console.log("  SET skipped: maxConfidence must be > 0 bps (contract requires a non-zero cap).\n");
            continue;
        }
        if (newMaxConf > UINT64_MAX) newMaxConf = UINT64_MAX;

        const staleness = stalenessOverride ?? maxStaleness;
        console.log(
            `  SET → setPythFeed(feedId=${feedId}, maxStaleness=${staleness}, maxConfidence=${newMaxConf} bps)`,
        );
        try {
            const tx = await oracle.setPythFeed(market, feedId, staleness, newMaxConf);
            console.log(`  tx sent: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`  confirmed in block ${receipt?.blockNumber} (status=${receipt?.status})\n`);
        } catch (err) {
            console.log(`  setPythFeed FAILED: ${err instanceof Error ? err.message : String(err)}`);
            console.log("  (signer must hold OPERATOR_ROLE on the OracleAggregator)\n");
        }
    }

    console.log("done.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
