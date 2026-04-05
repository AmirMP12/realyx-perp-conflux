const { ethers } = require("hardhat");

async function main() {
    try {
        const dummyAddress = "0x0000000000000000000000000000000000000001";
        const HarnessFactory = await ethers.getContractFactory("CoverageHarness", {
            libraries: {
                "contracts/libraries/MonitoringLib.sol:MonitoringLib": dummyAddress,
                "contracts/libraries/RateLimitLib.sol:RateLimitLib": dummyAddress,
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": dummyAddress,
                "contracts/libraries/CircuitBreakerLib.sol:CircuitBreakerLib": dummyAddress,
                "contracts/libraries/TradingLib.sol:TradingLib": dummyAddress,
            }
        });
        console.log("Success");
    } catch (e) {
        console.error(e.message);
    }
}

main();
