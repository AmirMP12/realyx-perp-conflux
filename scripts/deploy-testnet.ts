import { ethers } from "hardhat";
import { deployAll } from "./deploy";
import type { NetworkName } from "./helpers";
import { saveDeployment } from "./write-deployment";

const TESTNETS: NetworkName[] = ["confluxTestnet", "hardhat", "localhost"];

async function main() {
    const networkName = process.env.HARDHAT_NETWORK as NetworkName;
    if (!networkName || !TESTNETS.includes(networkName)) {
        throw new Error(
            `Invalid or missing HARDHAT_NETWORK. Use: npx hardhat run scripts/deploy-testnet.ts --network <confluxTestnet|hardhat|localhost>`,
        );
    }

    console.log(`\n>>> Deploying to ${networkName} <<<\n`);

    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "CFX\n");

    const result = await deployAll(networkName);
    const network = await ethers.provider.getNetwork();
    const filePath = saveDeployment(networkName, result, network.chainId);

    console.log("\nDeployment saved to:", filePath);
    console.log("\nDeployed addresses:");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n--- Post-deploy: add to your .env ---");
    console.log(`DEPLOYED_ORACLE_AGGREGATOR=${result.oracleAggregator}`);
    console.log(`DEPLOYED_VAULT_CORE=${result.vaultCore}`);
    console.log(`DEPLOYED_POSITION_TOKEN=${result.positionToken}`);
    console.log(`DEPLOYED_TRADING_CORE=${result.tradingCore}`);
    console.log(`DEPLOYED_MARKET_CALENDAR=${result.marketCalendar}`);
    console.log(`DEPLOYED_DIVIDEND_MANAGER=${result.dividendManager}`);
    console.log(`DEPLOYED_COMPLIANCE_MANAGER=${result.complianceManager}`);
    console.log(`DEPLOYED_DIVIDEND_KEEPER=${result.dividendKeeper}`);
    console.log(`DEPLOYED_TRADING_CORE_VIEWS=${result.tradingCoreViews}`);
    if (result.mockUsdc) console.log(`DEPLOYED_MOCK_USDC=${result.mockUsdc}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
