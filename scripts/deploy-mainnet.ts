import { ethers } from "hardhat";
import { deployAll } from "./deploy";
import type { NetworkName } from "./helpers";
import { saveDeployment } from "./write-deployment";

const MAINNETS: NetworkName[] = ["conflux"];

async function main() {
    const networkName = process.env.HARDHAT_NETWORK as NetworkName;
    if (!networkName || !MAINNETS.includes(networkName)) {
        throw new Error(
            `Invalid or missing HARDHAT_NETWORK. Use: npx hardhat run scripts/deploy-mainnet.ts --network conflux`
        );
    }

    const skipConfirm = process.env.SKIP_CONFIRMATIONS === "true";
    if (!skipConfirm && networkName !== "hardhat") {
        console.log(`\n>>> Deploying to ${networkName} eSpace <<<\n`);
        const readline = await import("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
            rl.question("Type 'yes' to confirm: ", resolve);
        });
        rl.close();
        if (answer?.toLowerCase() !== "yes") {
            console.log("Aborted.");
            process.exit(1);
        }
    }

    const result = await deployAll(networkName);
    const network = await ethers.provider.getNetwork();
    const filePath = saveDeployment(networkName, result, network.chainId);
    console.log("\nDeployment saved to:", filePath);
    console.log("\nDeployed addresses:");
    console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
