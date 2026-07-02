import "dotenv/config";
import { ethers } from "hardhat";
import { loadDeployment } from "./write-deployment";

const MARKETS = [
    { symbol: "BTC-USD", address: "0x986a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
    { symbol: "ETH-USD", address: "0x886a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
    { symbol: "CRCLX-USD", address: "0x486a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0xc13184461c0c80d98ffcd89be627c2220b94a96c7c67f0c4b16bc12fd3b17758" },
    { symbol: "COINX-USD", address: "0x966a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x641435d5dffb5311140b480517c79986d8488d5cf08a11eec53b83ad02cab33f" },
    { symbol: "CFX-USD", address: "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c", feedId: "0x8879170230c9603342f3837cf9a8e76c61791198fb1271bb2552c9af7b33c933" },
    { symbol: "NVDAX-USD", address: "0x786a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f" },
    { symbol: "TSLAX-USD", address: "0x686a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362" },
    { symbol: "METAX-USD", address: "0x586a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0xbf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900" },
    { symbol: "GOOGLX-USD", address: "0x386a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0xb911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e" },
    { symbol: "NFLXX-USD", address: "0x946a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x02a67e6184e6c9dd65e14745a2a80df8b2b3d2ca91b4b191404936003d9929ae" },
    { symbol: "AAPLX-USD", address: "0x956a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675" },
    { symbol: "MCDX-USD", address: "0x976a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x27cac3c00ed32285b8686611bbc4a654279c1ea11ab4dc90822c2edd20734bca" },
    { symbol: "MSTRX-USD", address: "0x116a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28" },
    { symbol: "HOODX-USD", address: "0x006a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0xdd49a9ac6df5cbfa9d8fc6371f7ae927a74d5c6763c1c01b4220d70314c647f9" },
    { symbol: "SPYX-USD", address: "0x706a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14" },
    { symbol: "XAUT-USD", address: "0x286a383f6de4a24dd3f524f0f93546229b58265f", feedId: "0x44465e17d2e9d390e70c999d5a11fda4f092847fcd2e3e5aa089d96c98a30e67" },
];

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

async function main() {
    const [signer] = await ethers.getSigners();
    const networkName = process.env.HARDHAT_NETWORK || "confluxTestnet";
    const deployment = loadDeployment(networkName);
    const oracleAddress = deployment?.contracts?.oracleAggregator;
    if (!oracleAddress) throw new Error("oracleAddress not found in deployment");

    const oracle = new ethers.Contract(oracleAddress, [
        "function pyth() external view returns (address)",
        "function updatePrices(bytes[] calldata priceUpdateData) external payable returns (uint256 feeRefund)",
        "function isOracleHealthy(address collection) external view returns (bool healthy, string memory reason)",
    ], signer);

    const pythAddress = await oracle.pyth();
    const pyth = new ethers.Contract(pythAddress, [
        "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
    ], signer);

    console.log(`network  : ${networkName}`);
    console.log(`oracle   : ${oracleAddress}`);
    console.log(`pyth     : ${pythAddress}`);
    console.log(`signer   : ${signer.address}`);

    console.log("\nFetching price updates from Hermes...");
    const ids = MARKETS.map(m => m.feedId.replace("0x", ""));
    const q = ids.map(id => `ids[]=${id}`).join("&");
    const url = `https://hermes.pyth.network/v2/updates/price/latest?encoding=hex&${q}`;
    
    const res = await fetchWithRetry(url);
    const body: any = await res.json();
    const raw = body.binary?.data ?? [];
    const updates = raw.filter(Boolean).map((d: string) => (d.startsWith("0x") ? d : `0x${d}`));
    console.log(`Fetched ${updates.length} batched update data items.`);

    if (updates.length > 0) {
        const fee = await pyth.getUpdateFee(updates);
        console.log(`Updating ${MARKETS.length} feeds... Total fee: ${fee.toString()} Wei`);

        const tx = await oracle.updatePrices(updates, { value: fee });
        console.log(`Transaction sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);
    }

    console.log("\nVerifying on-chain oracle health:");
    let allOk = true;
    for (const m of MARKETS) {
        const [healthy, reason] = await oracle.isOracleHealthy(m.address);
        console.log(`  ${m.symbol.padEnd(12)}: ${healthy ? "OK" : `UNHEALTHY (${reason})`}`);
        if (!healthy) allOk = false;
    }

    if (allOk) {
        console.log("\nAll price feeds updated successfully and healthy.");
    } else {
        console.warn("\nWarning: Some price feeds are still reported as unhealthy.");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
