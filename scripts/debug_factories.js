const { ethers } = require("hardhat");

async function main() {
    try {
        console.log("1. Fetching MockUSDC...");
        await ethers.getContractFactory("MockUSDC");
        
        console.log("2. Fetching MockPythWrapper...");
        await ethers.getContractFactory("MockPythWrapper");
        
        console.log("3. Fetching MonitoringLib...");
        // This one might need linking, but let's see if getContractFactory itself crashes
        await ethers.getContractFactory("MonitoringLib");
        
        console.log("4. Fetching CoverageHarness...");
        await ethers.getContractFactory("CoverageHarness");
        
        console.log("All factories fetched successfully");
    } catch (e) {
        console.error("FAILURE:", e.message);
    }
}

main();
