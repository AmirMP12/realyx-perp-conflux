import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verify MockUSDC on ConfluxScan.
 * Address resolution: env DEPLOYED_MOCK_USDC → deployment/<network>.json → error.
 */
async function main() {
    const network = process.env.HARDHAT_NETWORK || "confluxTestnet";

    let address = process.env.DEPLOYED_MOCK_USDC?.trim();
    if (!address) {
        const p = path.join(process.cwd(), "deployment", `${network}.json`);
        if (fs.existsSync(p)) {
            const j = JSON.parse(fs.readFileSync(p, "utf-8"));
            address = j?.contracts?.mockUsdc;
        }
    }

    if (!address) {
        console.error("MockUSDC address not found. Set DEPLOYED_MOCK_USDC or deploy first.");
        process.exit(1);
    }

    console.log(`Verifying MockUSDC at ${address} on ${network}...`);

    try {
        await run("verify:verify", {
            address,
            contract: "contracts/test/MockUSDC.sol:MockUSDC",
            constructorArguments: [],
        });
        console.log(`✓ Verified: MockUSDC at ${address}`);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Already Verified") || msg.includes("already verified")) {
            console.log(`✓ Already verified: MockUSDC at ${address}`);
        } else {
            console.error("✗ Verification failed:", msg);
            throw e;
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
