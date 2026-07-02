import "dotenv/config";
import { ethers } from "hardhat";
import { loadDeployment } from "./write-deployment";

/**
 * Inspect (and optionally update) per-market oracle config on `OracleAggregator`.
 *
 * POST UPGRADE: `maxConfidence` is a RELATIVE cap in BASIS POINTS of price
 * (e.g. 50 = 0.50%, 100 = 1%). Price-scale independent — works for BTC-class
 * assets whose absolute 1e18-normalized confidence exceeds uint64.
 *
 * This script knows all 16 protocol markets with per-category sensible defaults:
 *   • CRYPTO  → 100 bps (1.0%)   looser; crypto feeds can be noisy
 *   • STOCK   → 150 bps (1.5%)   loosest; synthetic equity feeds on testnet
 *   • COMMODITY → 100 bps (1.0%) gold/commodity feed
 *
 * Override for a specific market via `ORACLE_MAX_CONFIDENCE=<bps>` or let
 * `ORACLE_AUTO=true` size it from the live feed (live confidence bps × multiplier).
 *
 * Usage:
 *   # Inspect all 16 markets (read-only, default)
 *   npm run oracle:config:conflux-testnet
 *
 *   # Apply per-category defaults to all 16 markets
 *   ORACLE_SET=true  npm run oracle:config:conflux-testnet
 *
 *   # Apply a single explicit bps cap to all markets
 *   ORACLE_SET=true  ORACLE_MAX_CONFIDENCE=100  npm run oracle:config:conflux-testnet
 *
 *   # Auto-size from live feed (live bps × ORACLE_MAX_CONFIDENCE_MULTIPLIER)
 *   ORACLE_SET=true  ORACLE_AUTO=true  ORACLE_MAX_CONFIDENCE_MULTIPLIER=3  \
 *     npm run oracle:config:conflux-testnet
 *
 * Optional overrides:
 *   ORACLE_AGGREGATOR_ADDRESS   override deployment-file address
 *   ORACLE_MAX_STALENESS        override staleness (seconds) for all markets
 */

// ── Per-category default maxConfidence (bps of price) ──────────────────────
// Generous enough to absorb normal Pyth confidence variation, strict enough to
// catch a genuine feed blow-out. Can be tightened once real trading data is in.
const CATEGORY_MAX_CONF_BPS: Record<string, bigint> = {
    CRYPTO: 100n, // 1.0% — crypto feeds can spike
    STOCK: 150n, // 1.5% — synthetic equity feeds are noisier on testnet
    COMMODITY: 100n, // 1.0% — gold / commodity
    FOREX: 50n, // 0.5% — forex feeds are tight
};

type MarketDef = {
    address: string;
    symbol: string;
    category: string;
    feedId: string; // full 32-byte hex
    maxStaleness: number; // seconds
};

/** All 16 protocol markets. Addresses and feed IDs match .env / deployment. */
const MARKETS: MarketDef[] = [
    // ── Crypto ─────────────────────────────────────────────────────────────
    {
        address: "0x986a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "BTC-USD",
        category: "CRYPTO",
        feedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        maxStaleness: 900,
    },
    {
        address: "0x886a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "ETH-USD",
        category: "CRYPTO",
        feedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        maxStaleness: 900,
    },
    {
        address: "0x486a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "CRCLX-USD",
        category: "CRYPTO",
        feedId: "0xc13184461c0c80d98ffcd89be627c2220b94a96c7c67f0c4b16bc12fd3b17758",
        maxStaleness: 900,
    },
    {
        address: "0x966a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "COINX-USD",
        category: "CRYPTO",
        feedId: "0x641435d5dffb5311140b480517c79986d8488d5cf08a11eec53b83ad02cab33f",
        maxStaleness: 900,
    },
    {
        address: "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c",
        symbol: "CFX-USD",
        category: "CRYPTO",
        feedId: "0x8879170230c9603342f3837cf9a8e76c61791198fb1271bb2552c9af7b33c933",
        maxStaleness: 900,
    },
    // ── Stocks ──────────────────────────────────────────────────────────────
    {
        address: "0x786a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "NVDAX-USD",
        category: "STOCK",
        feedId: "0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f",
        maxStaleness: 900,
    },
    {
        address: "0x686a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "TSLAX-USD",
        category: "STOCK",
        feedId: "0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
        maxStaleness: 900,
    },
    {
        address: "0x586a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "METAX-USD",
        category: "STOCK",
        feedId: "0xbf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900",
        maxStaleness: 900,
    },
    {
        address: "0x386a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "GOOGLX-USD",
        category: "STOCK",
        feedId: "0xb911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e",
        maxStaleness: 900,
    },
    {
        address: "0x946a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "NFLXX-USD",
        category: "STOCK",
        feedId: "0x02a67e6184e6c9dd65e14745a2a80df8b2b3d2ca91b4b191404936003d9929ae",
        maxStaleness: 900,
    },
    {
        address: "0x956a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "AAPLX-USD",
        category: "STOCK",
        feedId: "0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
        maxStaleness: 900,
    },
    {
        address: "0x976a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "MCDX-USD",
        category: "STOCK",
        feedId: "0x27cac3c00ed32285b8686611bbc4a654279c1ea11ab4dc90822c2edd20734bca",
        maxStaleness: 900,
    },
    {
        address: "0x116a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "MSTRX-USD",
        category: "STOCK",
        feedId: "0x53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28",
        maxStaleness: 900,
    },
    {
        address: "0x006a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "HOODX-USD",
        category: "STOCK",
        feedId: "0xdd49a9ac6df5cbfa9d8fc6371f7ae927a74d5c6763c1c01b4220d70314c647f9",
        maxStaleness: 900,
    },
    {
        address: "0x706a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "SPYX-USD",
        category: "STOCK",
        feedId: "0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14",
        maxStaleness: 900,
    },
    // ── Commodity ───────────────────────────────────────────────────────────
    {
        address: "0x286a383f6de4a24dd3f524f0f93546229b58265f",
        symbol: "XAUT-USD",
        category: "COMMODITY",
        feedId: "0x44465e17d2e9d390e70c999d5a11fda4f092847fcd2e3e5aa089d96c98a30e67",
        maxStaleness: 900,
    },
];

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
const BPS = 10000n;

/** Replicates OracleAggregator._normalizePythPrice / _normalizePythConfidence (1e18 scale). */
function normalize(raw: bigint, expo: number): bigint {
    if (raw <= 0n) return 0n;
    const d = 18 + expo;
    if (d > 30 || d < -30) return 0n;
    if (d >= 0) return raw * 10n ** BigInt(d);
    const v = raw / 10n ** BigInt(-d);
    return v === 0n ? 1n : v;
}

async function main() {
    const networkName = process.env.HARDHAT_NETWORK || "confluxTestnet";
    const deployment = loadDeployment(networkName);
    const oracleAddress =
        process.env.ORACLE_AGGREGATOR_ADDRESS ||
        process.env.DEPLOYED_ORACLE_AGGREGATOR ||
        deployment?.contracts?.oracleAggregator;
    if (!oracleAddress) throw new Error("OracleAggregator address not found. Set ORACLE_AGGREGATOR_ADDRESS.");

    const doSet = (process.env.ORACLE_SET ?? "").toLowerCase() === "true";
    const auto = (process.env.ORACLE_AUTO ?? "").toLowerCase() === "true";
    const multiplier = BigInt(Math.max(1, Number(process.env.ORACLE_MAX_CONFIDENCE_MULTIPLIER ?? "3")));
    const explicitBps = process.env.ORACLE_MAX_CONFIDENCE ? BigInt(process.env.ORACLE_MAX_CONFIDENCE) : null;
    const stalenessOverride = process.env.ORACLE_MAX_STALENESS ? Number(process.env.ORACLE_MAX_STALENESS) : null;

    // Optional: restrict to a subset of markets via ORACLE_MARKETS (comma-separated addresses)
    const filterSet = process.env.ORACLE_MARKETS
        ? new Set(
              process.env.ORACLE_MARKETS.split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean),
          )
        : null;
    const markets = filterSet ? MARKETS.filter((m) => filterSet.has(m.address.toLowerCase())) : MARKETS;

    const [signer] = await ethers.getSigners();
    const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, signer);
    const pythAddress: string = await oracle.pyth();
    const pyth = new ethers.Contract(pythAddress, PYTH_ABI, signer);

    console.log(`network    : ${networkName}`);
    console.log(`oracle     : ${oracleAddress}`);
    console.log(`pyth       : ${pythAddress}`);
    console.log(`signer     : ${await signer.getAddress()}`);
    console.log(`mode       : ${doSet ? "SET" : "INSPECT (read-only)"}`);
    console.log(`markets    : ${markets.length} / ${MARKETS.length} total\n`);

    if (doSet && markets.length > 0) {
        console.log("Refreshing price feeds on-chain...");
        try {
            const ids = markets.map(m => m.feedId.replace(/^0x/i, ""));
            const q = ids.map(id => `ids[]=${id}`).join("&");
            const url = `https://hermes.pyth.network/v2/updates/price/latest?encoding=hex&${q}`;
            const res = await fetchWithRetry(url);
            if (!res.ok) throw new Error(`Hermes HTTP error ${res.status}`);
            const body: any = await res.json();
            const raw = body.binary?.data ?? [];
            const updates = raw.filter(Boolean).map((d: string) => (d.startsWith("0x") ? d : `0x${d}`));
            if (updates.length > 0) {
                const pythWithFee = new ethers.Contract(pythAddress, [
                    "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)"
                ], signer);
                const fee = await pythWithFee.getUpdateFee(updates);
                
                const oracleWithUpdate = new ethers.Contract(oracleAddress, [
                    "function updatePrices(bytes[] calldata priceUpdateData) external payable returns (uint256 feeRefund)"
                ], signer);
                const tx = await oracleWithUpdate.updatePrices(updates, { value: fee });
                console.log(`  Price update transaction sent: ${tx.hash}`);
                await tx.wait();
                console.log("  Price feeds refreshed successfully.\n");
            } else {
                console.log("  No price updates returned from Hermes.\n");
            }
        } catch (err: any) {
            console.log(`  Failed to refresh price feeds: ${err.message}\n`);
        }
    }

    // Fetch all live price updates from Hermes at once to avoid loop rate-limiting/timeouts
    const livePrices = new Map<string, { price: bigint; expo: number; conf: bigint; publishTime: number }>();
    console.log("Fetching live off-chain prices from Hermes...");
    try {
        const ids = markets.map(m => m.feedId.replace(/^0x/i, ""));
        const q = ids.map(id => `ids[]=${id}`).join("&");
        const url = `https://hermes.pyth.network/v2/updates/price/latest?${q}`;
        const res = await fetchWithRetry(url);
        const body: any = await res.json();
        for (const item of (body.parsed ?? [])) {
            const feedIdStr = item.id.startsWith("0x") ? item.id.toLowerCase() : "0x" + item.id.toLowerCase();
            livePrices.set(feedIdStr, {
                price: BigInt(item.price.price),
                expo: Number(item.price.expo),
                conf: BigInt(item.price.conf),
                publishTime: Number(item.price.publish_time)
            });
        }
        console.log(`Fetched ${livePrices.size} live prices from Hermes successfully.\n`);
    } catch (err: any) {
        console.log(`Warning: Failed to fetch live prices in batch: ${err.message}. Will fall back during loop.\n`);
    }

    let ok = 0;
    let skipped = 0;
    let failed = 0;

    for (const market of markets) {
        console.log(`── ${market.symbol.padEnd(12)} ${market.address} ──────────────────────`);

        // ── Current on-chain config ─────────────────────────────────────────
        let onChainFeedId = "";
        let onChainStaleness = 0n;
        try {
            const [feedId, maxStaleness] = (await oracle.getOracleConfig(market.address)) as [
                string,
                bigint,
                bigint,
                bigint,
            ];
            onChainFeedId = feedId;
            onChainStaleness = maxStaleness;
            if (feedId === ZERO_BYTES32) {
                console.log("  on-chain : NOT CONFIGURED");
            } else {
                const [healthy, reason] = (await oracle.isOracleHealthy(market.address)) as [boolean, string];
                console.log(
                    `  on-chain : feedId=${feedId.slice(0, 14)}… staleness=${maxStaleness}s health=${healthy ? "OK" : `UNHEALTHY (${reason})`}`,
                );
            }
        } catch {
            console.log("  on-chain : getOracleConfig failed");
        }

        // ── Live Pyth feed (fetched from Hermes off-chain) ──────────────────
        let liveConfBps = 0n;
        try {
            const normalizedFeedId = market.feedId.toLowerCase();
            let parsed = livePrices.get(normalizedFeedId);
            if (!parsed) {
                // Fallback: try fetching individually if batch failed or missed this feed
                const idNo0x = market.feedId.replace(/^0x/i, "");
                const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${idNo0x}`;
                const res = await fetchWithRetry(url, 2, 1000); // fewer retries for fallback
                const body: any = await res.json();
                const item = body.parsed?.[0];
                if (!item) throw new Error("No parsed data in Hermes response");
                parsed = {
                    price: BigInt(item.price.price),
                    expo: Number(item.price.expo),
                    conf: BigInt(item.price.conf),
                    publishTime: Number(item.price.publish_time)
                };
            }

            const normPrice = normalize(parsed.price, parsed.expo);
            const normConf = normalize(parsed.conf, parsed.expo);
            liveConfBps = normPrice > 0n ? (normConf * BPS) / normPrice : 0n;
            const ageSec = BigInt(Math.floor(Date.now() / 1000)) - BigInt(parsed.publishTime);
            console.log(
                `  live     : price≈$${(Number(normPrice) / 1e18).toFixed(2).padStart(12)} conf=${liveConfBps} bps (${(Number(liveConfBps) / 100).toFixed(3)}%) age=${ageSec}s`,
            );
        } catch (err: any) {
            console.log(`  live     : Failed to fetch from Hermes (${err.message})`);
        }

        // ── Determine the target maxConfidence ──────────────────────────────
        let targetBps: bigint;
        if (explicitBps != null) {
            targetBps = explicitBps;
        } else if (auto && liveConfBps > 0n) {
            targetBps = liveConfBps * multiplier;
            if (targetBps > UINT64_MAX) targetBps = UINT64_MAX;
        } else {
            targetBps = CATEGORY_MAX_CONF_BPS[market.category] ?? 100n;
        }
        const targetStaleness =
            stalenessOverride ?? (onChainStaleness > 0n ? Number(onChainStaleness) : market.maxStaleness);

        console.log(
            `  target   : maxConfidence=${targetBps} bps (${(Number(targetBps) / 100).toFixed(2)}%)  maxStaleness=${targetStaleness}s  [${auto ? "auto" : explicitBps != null ? "explicit" : "category-default"}]`,
        );

        if (!doSet) {
            console.log("");
            skipped++;
            continue;
        }

        // ── Apply ───────────────────────────────────────────────────────────
        const feedBytes32 = ethers.hexlify(
            ethers.zeroPadValue(
                ethers.getBytes(market.feedId.startsWith("0x") ? market.feedId : "0x" + market.feedId),
                32,
            ),
        );
        try {
            const tx = await oracle.setPythFeed(market.address, feedBytes32, targetStaleness, targetBps);
            console.log(`  SET      : tx ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`  DONE     : block=${receipt?.blockNumber} status=${receipt?.status}\n`);
            ok++;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`  FAILED   : ${msg}`);
            if (msg.includes("PendingFeedMismatch") || msg.includes("FeedTimelockActive")) {
                console.log(
                    "  NOTE     : Rotating to a different feedId requires proposePythFeed first (24h timelock).",
                );
            }
            console.log("");
            failed++;
        }
    }

    const notRun = markets.length - ok - failed - skipped;
    console.log(
        `\n${"─".repeat(60)}\n` +
            (doSet
                ? `Updated: ${ok}  Failed: ${failed}  Skipped: ${notRun}`
                : `Inspected: ${markets.length}  (re-run with ORACLE_SET=true to apply)`),
    );
}

async function fetchWithRetry(url: string, retries = 3, delayMs = 1500): Promise<Response> {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 12000); // 12s timeout
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            if (res.ok) return res;
            console.log(`  Hermes fetch failed: HTTP ${res.status}. Retrying in ${delayMs}ms...`);
        } catch (err: any) {
            console.log(`  Hermes fetch connection error: ${err.message}. Retrying in ${delayMs}ms...`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    throw new Error(`Failed to fetch from Hermes after ${retries} attempts`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
