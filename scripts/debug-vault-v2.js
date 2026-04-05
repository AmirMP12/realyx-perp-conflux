const { ethers } = require("hardhat");

async function main() {
    const [admin] = await ethers.getSigners();
    const VaultCore = await ethers.getContractFactory("VaultCore");
    const vault = await (await VaultCore.deploy()).waitForDeployment();
    await vault.initialize(admin.address, admin.address, admin.address);
    
    console.log("Calling triggerEmergencyMode...");
    try {
        await vault.triggerEmergencyMode();
        console.log("Success!");
    } catch (e) {
        console.log("ERROR CODE:", e.code);
        console.log("ERROR MESSAGE:", e.message);
        console.log("ERROR INFO:", JSON.stringify(e.info, null, 2));
    }
}

main().catch(console.error);
