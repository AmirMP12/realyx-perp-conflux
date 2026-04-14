import { ethers } from "hardhat";
import { requireEnv } from "./helpers";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Seeding liquidity with account:", deployer.address);

    let mockUsdcAddr = process.env.DEPLOYED_MOCK_USDC;
    let vaultAddr = process.env.DEPLOYED_VAULT_CORE;

    // Try to load from deployment file if env vars are missing
    if (!mockUsdcAddr || !vaultAddr) {
        try {
            const net = process.env.HARDHAT_NETWORK || "confluxTestnet";
            const deploymentPath = path.join(__dirname, "..", "deployment", `${net}.json`);
            if (fs.existsSync(deploymentPath)) {
                const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as {
                    contracts?: { mockUsdc?: string; usdc?: string; vaultCore?: string };
                    flags?: { usdcIsMock?: boolean };
                };
                if (deployment.flags?.usdcIsMock === false) {
                    throw new Error(
                        "This deployment uses real USDC (usdcIsMock: false). seed-liquidity.ts only supports MockUSDC mint/deposit flows.",
                    );
                }
                mockUsdcAddr = mockUsdcAddr || deployment.contracts?.mockUsdc || deployment.contracts?.usdc;
                vaultAddr = vaultAddr || deployment.contracts?.vaultCore;
                console.log("Loaded addresses from deployment/" + net + ".json");
            }
        } catch (e) {
            if (e instanceof Error && e.message.includes("real USDC")) throw e;
            console.log("Could not load deployment file, relying on environment variables.");
        }
    }

    if (!mockUsdcAddr) mockUsdcAddr = requireEnv("DEPLOYED_MOCK_USDC");
    if (!vaultAddr) vaultAddr = requireEnv("DEPLOYED_VAULT_CORE");

    console.log("MockUSDC:", mockUsdcAddr);
    console.log("VaultCore:", vaultAddr);

    const mockUsdc = await ethers.getContractAt("MockUSDC", mockUsdcAddr);
    const vault = await ethers.getContractAt("VaultCore", vaultAddr);

    const amountPerFund = ethers.parseUnits("10000000", 6); // $10,000,000
    const totalAmount = amountPerFund * 2n;

    console.log("\n1. Minting $20,000,000 Mock USDC...");
    const mintTx = await mockUsdc.mintTo(deployer.address, totalAmount);
    await mintTx.wait();
    console.log("Minted. Hash:", mintTx.hash);

    console.log("\n2. Approving VaultCore to spend USDC...");
    const approveTx = await mockUsdc.approve(vaultAddr, totalAmount);
    await approveTx.wait();
    console.log("Approved. Hash:", approveTx.hash);

    console.log("\n3. Depositing $10,000,000 into Vault LP pool...");
    const depositTx = await vault.deposit(amountPerFund, deployer.address);
    await depositTx.wait();
    console.log("Deposited into LP. Hash:", depositTx.hash);

    console.log("\n4. Staking $10,000,000 into Insurance Fund...");
    const stakeTx = await vault.stakeInsurance(amountPerFund, deployer.address);
    await stakeTx.wait();
    console.log("Staked into Insurance. Hash:", stakeTx.hash);

    console.log("\n--- Seeding Complete ---");
    const lpAssets = await vault.lpAssets();
    const insAssets = await vault.insuranceAssets();
    console.log("Current LP Assets:", ethers.formatUnits(lpAssets, 6), "USDC");
    console.log("Current Insurance Assets:", ethers.formatUnits(insAssets, 6), "USDC");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
