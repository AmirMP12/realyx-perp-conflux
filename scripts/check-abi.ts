import { artifacts, ethers } from "hardhat";

async function main() {
    const { abi } = await artifacts.readArtifact("TradingCore");
    const iface = new ethers.Interface(abi);
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
