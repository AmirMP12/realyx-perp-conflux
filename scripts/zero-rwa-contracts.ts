import { ethers } from "hardhat";
import { requireEnv } from "./helpers";

/**
 * Disable the optional RWA modules on TradingCore by setting marketCalendar,
 * dividendManager, and complianceManager to the zero address.
 *
 * TradingCore.setRWAContracts only applies immediately on first-time wire-up.
 * Once initialized (any prior successful call), rotations — including zeroing —
 * are guarded by a 48h timelock: proposeRWAContracts(...) then, after the delay,
 * setRWAContracts(...) with the exact same triple.
 *
 * This script detects the current state and does the right thing:
 *   • not yet initialized  → setRWAContracts(0,0,0) immediately
 *   • initialized, no/old proposal → proposeRWAContracts(0,0,0) and report ETA
 *   • initialized, matching proposal past its ETA → setRWAContracts(0,0,0)
 *
 * Env:
 *   DEPLOYED_TRADING_CORE   TradingCore proxy address (required)
 *
 * Run:
 *   npm run rwa:disable            (confluxTestnet)
 *   npm run rwa:disable:mainnet    (conflux)
 */

const ZERO = ethers.ZeroAddress;

async function assertContractCode(address: string, label: string): Promise<void> {
    const code = await ethers.provider.getCode(address);
    if (!code || code === "0x") {
        const { chainId } = await ethers.provider.getNetwork();
        throw new Error(`${label} at ${address} has no bytecode on chainId ${chainId}.`);
    }
}

async function main() {
    const tradingCoreAddr = requireEnv("DEPLOYED_TRADING_CORE");
    await assertContractCode(tradingCoreAddr, "TradingCore");

    const tc = await ethers.getContractAt("TradingCore", tradingCoreAddr);
    const [signer] = await ethers.getSigners();
    console.log(`Signer:      ${signer.address}`);
    console.log(`TradingCore: ${tradingCoreAddr}`);

    const [calendar, dividend, compliance] = await Promise.all([
        tc.marketCalendar(),
        tc.dividendManager(),
        tc.complianceManager(),
    ]);
    console.log(`Current RWA modules:`);
    console.log(`  marketCalendar=${calendar}`);
    console.log(`  dividendManager=${dividend}`);
    console.log(`  complianceManager=${compliance}`);

    if (calendar === ZERO && dividend === ZERO && compliance === ZERO) {
        console.log("All RWA modules are already zero. Nothing to do.");
        return;
    }

    // Try the immediate path first. If TradingCore has not been initialized yet,
    // setRWAContracts(0,0,0) succeeds outright. staticCall avoids spending gas to
    // discover which branch we are in.
    let immediateOk = false;
    try {
        await tc.setRWAContracts.staticCall(ZERO, ZERO, ZERO);
        immediateOk = true;
    } catch {
        immediateOk = false;
    }

    if (immediateOk) {
        console.log("Uninitialized wire-up detected — zeroing immediately ...");
        const tx = await tc.setRWAContracts(ZERO, ZERO, ZERO);
        await tx.wait();
        console.log(`Done. RWA modules zeroed. tx=${tx.hash}`);
        return;
    }

    // Initialized: the timelocked rotation path applies.
    const [pCal, pDiv, pComp, effective] = await tc.pendingRWAContracts();
    const now = Math.floor(Date.now() / 1000);
    const proposalMatchesZero = pCal === ZERO && pDiv === ZERO && pComp === ZERO;
    const effectiveNum = Number(effective);

    if (proposalMatchesZero && effectiveNum !== 0 && now >= effectiveNum) {
        console.log("Matching zero proposal is past its timelock — applying ...");
        const tx = await tc.setRWAContracts(ZERO, ZERO, ZERO);
        await tx.wait();
        console.log(`Done. RWA modules zeroed. tx=${tx.hash}`);
        return;
    }

    if (proposalMatchesZero && effectiveNum !== 0 && now < effectiveNum) {
        const eta = new Date(effectiveNum * 1000).toISOString();
        console.log(`A zero proposal is already staged but still in timelock.`);
        console.log(`Re-run this script after ${eta} to apply it.`);
        return;
    }

    console.log("Initialized contract — staging a zero proposal under the 48h timelock ...");
    const tx = await tc.proposeRWAContracts(ZERO, ZERO, ZERO);
    await tx.wait();
    const [, , , newEffective] = await tc.pendingRWAContracts();
    const eta = new Date(Number(newEffective) * 1000).toISOString();
    console.log(`Proposed. tx=${tx.hash}`);
    console.log(`Timelock expires at ${eta}. Re-run this script after that to apply.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
