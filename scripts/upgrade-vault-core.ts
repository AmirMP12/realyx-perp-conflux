import { ethers, upgrades } from "hardhat";
import hre from "hardhat";
import { loadDeployment } from "./write-deployment";

/**
 * UUPS upgrade VaultCore implementation in-place.
 *
 * Proxy address resolution (first match wins):
 * 1. VAULT_CORE_PROXY or PROXY_ADDRESS env
 * 2. contracts.vaultCore in deployment/<network>.json (e.g. deployment/confluxTestnet.json)
 *
 * Caller must be the Vault admin (UUPS _authorizeUpgrade).
 *
 * After a successful upgrade, refresh ABIs for apps:
 *   npm run compile && npm run export-abi && npm run sync:frontend-abi
 */
async function main() {
    const networkName = hre.network.name;
    const proxyEnv = (process.env.VAULT_CORE_PROXY ?? process.env.PROXY_ADDRESS)?.trim();

    let proxyAddress: string;
    if (proxyEnv) {
        proxyAddress = proxyEnv;
        console.log("VaultCore proxy (from env):", proxyAddress);
    } else {
        const dep = loadDeployment(networkName);
        const fromFile = dep?.contracts?.vaultCore as string | undefined;
        if (!fromFile) {
            throw new Error(
                `Set VAULT_CORE_PROXY=0x... or add deployment/${networkName}.json with contracts.vaultCore (from a prior deploy).`,
            );
        }
        proxyAddress = fromFile;
        console.log(`VaultCore proxy (from deployment/${networkName}.json):`, proxyAddress);
    }

    const code = await ethers.provider.getCode(proxyAddress);
    if (!code || code === "0x") {
        const { chainId } = await ethers.provider.getNetwork();
        throw new Error(`No contract code at ${proxyAddress} (chainId ${chainId}). Wrong network or address.`);
    }

    const [deployer] = await ethers.getSigners();
    console.log("Network:", networkName);
    console.log("Upgrader:", deployer.address);

    const VaultCore = await ethers.getContractFactory("VaultCore");
    const upgraded = await upgrades.upgradeProxy(proxyAddress, VaultCore);
    await upgraded.waitForDeployment();

    const impl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log("VaultCore upgraded.");
    console.log("  Proxy:           ", proxyAddress);
    console.log("  Implementation:", impl);
    console.log("\nNext: npm run compile && npm run export-abi && npm run sync:frontend-abi");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
