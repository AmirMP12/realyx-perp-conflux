import { ethers } from "hardhat";
import { requireEnv } from "./helpers";

async function main() {
    const tradingCoreAddr = requireEnv("DEPLOYED_TRADING_CORE");
    const marketAddress = (process.env.MARKET_ADDRESS ?? process.env.UNLIST_MARKET_ADDRESS)?.trim();
    if (!marketAddress || !ethers.isAddress(marketAddress)) {
        throw new Error("Set MARKET_ADDRESS or UNLIST_MARKET_ADDRESS to the market to unlist.");
    }

    console.log("TradingCore:", tradingCoreAddr);
    console.log("Unlisting market:", marketAddress);

    const tradingCore = await ethers.getContractAt("TradingCore", tradingCoreAddr);
    const info = await tradingCore.getMarketInfo(marketAddress);

    if (!info.isListed) {
        console.log("Market is not listed; nothing to do.");
        return;
    }

    const tx = await tradingCore.unlistMarket(marketAddress);
    console.log("Tx hash:", tx.hash);
    await tx.wait();
    console.log("Unlisted.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
