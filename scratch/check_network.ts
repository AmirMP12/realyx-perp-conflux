import { ethers } from "hardhat";

async function main() {
    const [signer] = await ethers.getSigners();
    const balance = await ethers.provider.getBalance(signer.address);
    const feeData = await ethers.provider.getFeeData();
    const network = await ethers.provider.getNetwork();

    console.log("Network Name:", network.name);
    console.log("Chain ID:", network.chainId.toString());
    console.log("Signer Address:", signer.address);
    console.log("Balance:", ethers.formatEther(balance), "CFX");
    console.log("Gas Price:", ethers.formatUnits(feeData.gasPrice || 0, "gwei"), "Gwei");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
