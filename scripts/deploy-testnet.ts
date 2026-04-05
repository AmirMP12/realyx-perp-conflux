import { ethers } from "hardhat";
import { deployAll } from "./deploy";
import type { NetworkName } from "./helpers";
import { saveDeployment } from "./write-deployment";

const TESTNETS: NetworkName[] = ["confluxTestnet", "hardhat", "localhost"];

async function main() {
    const networkName = process.env.HARDHAT_NETWORK as NetworkName;
    if (!networkName || !TESTNETS.includes(networkName)) {
        throw new Error(
            `Invalid or missing HARDHAT_NETWORK. Use: npx hardhat run scripts/deploy-testnet.ts --network <confluxTestnet|hardhat|localhost>`
        );
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
