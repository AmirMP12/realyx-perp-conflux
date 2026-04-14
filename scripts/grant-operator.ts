import { ethers } from "hardhat";
import { requireEnv } from "./helpers";

const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

async function assertContractCode(address: string, label: string): Promise<void> {
    const code = await ethers.provider.getCode(address);
    if (!code || code === "0x") {
        const { chainId } = await ethers.provider.getNetwork();
        throw new Error(
            `${label} at ${address} has no bytecode on this chain (chainId ${chainId}). ` +
                `Addresses in deployment/confluxTestnet.json are for Conflux eSpace **testnet** (chain 71). ` +
                `If that is what you intend, run:\n` +
                `  npx hardhat run scripts/grant-operator.ts --network confluxTestnet\n` +
                `Mainnet uses --network conflux (chain 1030) and needs deployment/conflux.json (or equivalent) addresses.`,
        );
    }
}

async function main() {
    const oracleAddr = requireEnv("DEPLOYED_ORACLE_AGGREGATOR");
    const tradingCoreAddr = requireEnv("DEPLOYED_TRADING_CORE");
    const [signer] = await ethers.getSigners();
    const grantTo = process.env.GRANT_TO_ADDRESS?.trim() || signer.address;

    console.log("Granting OPERATOR_ROLE to:", grantTo);
    console.log("OracleAggregator:", oracleAddr);
    console.log("TradingCore:", tradingCoreAddr);

    await assertContractCode(oracleAddr, "OracleAggregator");
    await assertContractCode(tradingCoreAddr, "TradingCore");

    const oa = await ethers.getContractAt("OracleAggregator", oracleAddr);
    const tc = await ethers.getContractAt("TradingCore", tradingCoreAddr);

    if (await oa.hasRole(OPERATOR_ROLE, grantTo)) {
        console.log("OracleAggregator: account already has OPERATOR_ROLE");
    } else {
        await oa.grantRole(OPERATOR_ROLE, grantTo);
        console.log("OracleAggregator: granted OPERATOR_ROLE");
    }

    if (await tc.hasRole(OPERATOR_ROLE, grantTo)) {
        console.log("TradingCore: account already has OPERATOR_ROLE");
    } else {
        await tc.grantRole(OPERATOR_ROLE, grantTo);
        console.log("TradingCore: granted OPERATOR_ROLE");
    }

    console.log("\nDone. You can now run setup-market.ts.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
