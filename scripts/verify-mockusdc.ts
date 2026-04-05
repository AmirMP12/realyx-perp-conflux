import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const MOCK_USDC_ADDRESS = "0x14D21f963EA8a644235Dd4d9D643437310cB4DeF";

async function main() {
    const address =
        process.env.DEPLOYED_MOCK_USDC ||
        (() => {
            const p = path.join(__dirname, "../deployment/confluxTestnet.json");
            if (fs.existsSync(p)) {
                const j = JSON.parse(fs.readFileSync(p, "utf-8"));
                return j?.contracts?.mockUsdc ?? MOCK_USDC_ADDRESS;
            }
            return MOCK_USDC_ADDRESS;
        })();

    console.log(`Verifying MockUSDC at ${address}...`);

    try {
        await run("verify:verify", {
            address,
            contract: "contracts/test/MockUSDC.sol:MockUSDC",
            constructorArguments: [],
        });
        console.log(`Verified: MockUSDC at ${address}`);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Already Verified") || msg.includes("already verified")) {
            console.log(`Already verified: MockUSDC at ${address}`);
        } else {
            console.error("Verification failed:", msg);
            throw e;
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
