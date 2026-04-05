import { run } from "hardhat";

async function main() {
    const addresses: { name: string; address: string }[] = [];

    const push = (name: string, envKey: string) => {
        const a = process.env[envKey];
        if (a) addresses.push({ name, address: a });
    };

    push("OracleAggregator", "DEPLOYED_ORACLE_AGGREGATOR");
    push("VaultCore", "DEPLOYED_VAULT_CORE");
    push("PositionToken", "DEPLOYED_POSITION_TOKEN");
    push("TradingCore", "DEPLOYED_TRADING_CORE");
    push("MarketCalendar", "DEPLOYED_MARKET_CALENDAR");
    push("DividendManager", "DEPLOYED_DIVIDEND_MANAGER");
    push("AllowListCompliance", "DEPLOYED_COMPLIANCE_MANAGER");
    push("DividendKeeper", "DEPLOYED_DIVIDEND_KEEPER");
    push("TradingCoreViews", "DEPLOYED_TRADING_CORE_VIEWS");
    push("MockUSDC", "DEPLOYED_MOCK_USDC");

    if (addresses.length === 0) {
        console.log("No DEPLOYED_* env vars set. Set addresses and re-run.");
        process.exit(0);
    }

    for (const { name, address } of addresses) {
        try {
            await run("verify:verify", { address });
            console.log(`Verified: ${name} at ${address}`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("Already Verified") || msg.includes("already verified")) {
                console.log(`Already verified: ${name} at ${address}`);
            } else {
                console.error(`Failed to verify ${name}:`, msg);
            }
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
