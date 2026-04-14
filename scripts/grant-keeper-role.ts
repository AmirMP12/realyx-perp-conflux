import { ethers } from "hardhat";
import { requireEnv } from "./helpers";

const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));

async function assertContractCode(address: string, label: string): Promise<void> {
    const code = await ethers.provider.getCode(address);
    if (!code || code === "0x") {
        const { chainId } = await ethers.provider.getNetwork();
        throw new Error(`${label} at ${address} has no bytecode on chainId ${chainId}.`);
    }
}

async function main() {
    const tradingCoreAddr = requireEnv("DEPLOYED_TRADING_CORE");
    const [signer] = await ethers.getSigners();
    const grantTo = process.env.GRANT_TO_ADDRESS?.trim() || signer.address;

    await assertContractCode(tradingCoreAddr, "TradingCore");
    const tc = await ethers.getContractAt("TradingCore", tradingCoreAddr);

    if (await tc.hasRole(KEEPER_ROLE, grantTo)) {
        console.log(`TradingCore: ${grantTo} already has KEEPER_ROLE`);
        return;
    }

    console.log(`Granting KEEPER_ROLE to ${grantTo} on TradingCore ${tradingCoreAddr} ...`);
    const tx = await tc.grantRole(KEEPER_ROLE, grantTo);
    await tx.wait();
    console.log(`Granted. tx=${tx.hash}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
