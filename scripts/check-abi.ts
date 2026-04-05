import { ethers } from "hardhat";

async function main() {
    const ITradingCore = await ethers.getContractFactory("ITradingCore");
    const iface = ITradingCore.interface;
    const fragment = iface.getFunction("closePosition");
    if (fragment) {
        console.log("Function:", fragment.name);
        console.log("Inputs:", JSON.stringify(fragment.inputs, null, 2));
    } else {
        console.log("Function not found!");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
