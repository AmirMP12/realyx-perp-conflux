import { ethers, upgrades, network } from "hardhat";

/**
 * UUPS upgrade for the `KeeperNetwork` module.
 *
 * KeeperNetwork has no linked libraries, so this is a plain `upgradeProxy`.
 * (`scripts/upgrade.ts` is reserved for the library-linked TradingCore path.)
 *
 * Env:
 *   KEEPER_NETWORK_ADDRESS   deployed KeeperNetwork proxy (required)
 */
async function main() {
    const proxyAddress = process.env.KEEPER_NETWORK_ADDRESS?.trim();
    if (!proxyAddress) throw new Error("KEEPER_NETWORK_ADDRESS is required.");

    const code = await ethers.provider.getCode(proxyAddress);
    if (!code || code === "0x") throw new Error(`No bytecode at ${proxyAddress} on ${network.name}.`);

    console.log(`Upgrading KeeperNetwork at ${proxyAddress} on ${network.name} ...`);
    const KeeperNetwork = await ethers.getContractFactory("KeeperNetwork");
    const upgraded = await upgrades.upgradeProxy(proxyAddress, KeeperNetwork, { kind: "uups" });
    await upgraded.waitForDeployment();

    const impl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log(`KeeperNetwork upgraded. Proxy: ${proxyAddress}, Implementation: ${impl}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
