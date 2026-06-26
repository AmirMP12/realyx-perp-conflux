/**
 * S2 — Move admin/operator authority behind a multisig (+ optional on-chain timelock).
 *
 * Realyx already enforces 48h in-contract timelocks on the highest-impact
 * actions (UUPS upgrades, treasury / TradingCore / RWA-contracts / oracle-feed /
 * referral-registry / trading-views rotations). The remaining residual risk is
 * that the privileged ROLE HOLDERS are EOAs. This script hands the privileged
 * roles of every deployed contract to a multisig (e.g. a Gnosis Safe) or, for
 * full delay coverage on the immediate-effect parameter setters, to an
 * OpenZeppelin `TimelockController` whose proposer/executor is that multisig.
 *
 * USAGE
 *   1. (Optional) Deploy an OZ TimelockController with the Safe as proposer &
 *      executor, and use its address as ADMIN_MULTISIG to also delay the
 *      immediate-effect setters (setFeeConfig / setLimits / setParams / …).
 *   2. Populate .env with the DEPLOYED_* addresses (printed by deploy-mainnet.ts)
 *      and ADMIN_MULTISIG=<safe-or-timelock>.
 *   3. Dry run (default): prints the planned grants without sending.
 *        npx hardhat run scripts/transfer-admin.ts --network conflux
 *   4. Execute the grants:
 *        APPLY=true npx hardhat run scripts/transfer-admin.ts --network conflux
 *   5. Only AFTER verifying the multisig can operate every contract, renounce
 *      the deployer's roles (IRREVERSIBLE):
 *        APPLY=true RENOUNCE_DEPLOYER=true npx hardhat run scripts/transfer-admin.ts --network conflux
 *
 * SAFETY
 *   - Grants are additive and reversible until the deployer renounces.
 *   - Renounce is gated behind a separate explicit flag and runs last.
 *   - Ownable contracts (CopyRegistry) use a one-shot `transferOwnership`.
 */
import { ethers } from "hardhat";

const id = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));

const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ADMIN_ROLE = id("ADMIN_ROLE");
const OPERATOR_ROLE = id("OPERATOR_ROLE");
const GUARDIAN_ROLE = id("GUARDIAN_ROLE");
const ORACLE_ROLE = id("ORACLE_ROLE");
const MANAGER_ROLE = id("MANAGER_ROLE");
const UPGRADER_ROLE = id("UPGRADER_ROLE");

const APPLY = process.env.APPLY === "true";
const RENOUNCE = process.env.RENOUNCE_DEPLOYER === "true";

function need(key: string): string {
    const v = process.env[key]?.trim();
    if (!v) throw new Error(`Missing required env: ${key}`);
    return v;
}
function opt(key: string): string | undefined {
    const v = process.env[key]?.trim();
    return v && v.length > 0 ? v : undefined;
}

/**
 * Each entry describes how to migrate one contract's privileged authority.
 * `accessControl` contracts use OZ AccessControl role grants; `ownable`
 * contracts use `transferOwnership`.
 */
type Plan =
    | { kind: "accessControl"; name: string; artifact: string; addrEnv: string; roles: string[] }
    | { kind: "ownable"; name: string; artifact: string; addrEnv: string };

const PLANS: Plan[] = [
    // AccessControlled (DEFAULT_ADMIN + ADMIN, plus operational roles).
    {
        kind: "accessControl",
        name: "OracleAggregator",
        artifact: "OracleAggregator",
        addrEnv: "DEPLOYED_ORACLE_AGGREGATOR",
        roles: [DEFAULT_ADMIN_ROLE, ADMIN_ROLE, OPERATOR_ROLE, GUARDIAN_ROLE, ORACLE_ROLE],
    },
    {
        kind: "accessControl",
        name: "VaultCore",
        artifact: "VaultCore",
        addrEnv: "DEPLOYED_VAULT_CORE",
        roles: [DEFAULT_ADMIN_ROLE, ADMIN_ROLE, OPERATOR_ROLE, GUARDIAN_ROLE],
    },
    {
        kind: "accessControl",
        name: "TradingCore",
        artifact: "TradingCore",
        addrEnv: "DEPLOYED_TRADING_CORE",
        roles: [DEFAULT_ADMIN_ROLE, ADMIN_ROLE, OPERATOR_ROLE, GUARDIAN_ROLE],
    },
    {
        kind: "accessControl",
        name: "ReferralRegistry",
        artifact: "ReferralRegistry",
        addrEnv: "DEPLOYED_REFERRAL_REGISTRY",
        roles: [DEFAULT_ADMIN_ROLE, ADMIN_ROLE],
    },
    // PositionToken uses DEFAULT_ADMIN + UPGRADER (MINTER stays with TradingCore).
    {
        kind: "accessControl",
        name: "PositionToken",
        artifact: "PositionToken",
        addrEnv: "DEPLOYED_POSITION_TOKEN",
        roles: [DEFAULT_ADMIN_ROLE, UPGRADER_ROLE],
    },
    // DividendManager / MarketCalendar / AllowListCompliance: DEFAULT_ADMIN + MANAGER.
    {
        kind: "accessControl",
        name: "DividendManager",
        artifact: "DividendManager",
        addrEnv: "DEPLOYED_DIVIDEND_MANAGER",
        roles: [DEFAULT_ADMIN_ROLE, MANAGER_ROLE],
    },
    {
        kind: "accessControl",
        name: "MarketCalendar",
        artifact: "MarketCalendar",
        addrEnv: "DEPLOYED_MARKET_CALENDAR",
        roles: [DEFAULT_ADMIN_ROLE, MANAGER_ROLE],
    },
    {
        kind: "accessControl",
        name: "AllowListCompliance",
        artifact: "AllowListCompliance",
        addrEnv: "DEPLOYED_COMPLIANCE_MANAGER",
        roles: [DEFAULT_ADMIN_ROLE, MANAGER_ROLE],
    },
    // CollateralRegistry: DEFAULT_ADMIN + OPERATOR (TRADING_CORE_ROLE stays with TradingCore).
    {
        kind: "accessControl",
        name: "CollateralRegistry",
        artifact: "CollateralRegistry",
        addrEnv: "DEPLOYED_COLLATERAL_REGISTRY",
        roles: [DEFAULT_ADMIN_ROLE, OPERATOR_ROLE],
    },
    // Ownable
    { kind: "ownable", name: "CopyRegistry", artifact: "CopyRegistry", addrEnv: "DEPLOYED_COPY_REGISTRY" },
];

async function main() {
    const newAdmin = need("ADMIN_MULTISIG");
    if (!ethers.isAddress(newAdmin)) throw new Error(`ADMIN_MULTISIG is not a valid address: ${newAdmin}`);

    const [deployer] = await ethers.getSigners();
    console.log("Deployer (current admin):", deployer.address);
    console.log("New admin (multisig/timelock):", newAdmin);
    console.log("Mode:", APPLY ? "APPLY" : "DRY-RUN", RENOUNCE ? "+ RENOUNCE-DEPLOYER" : "");
    console.log("");

    for (const plan of PLANS) {
        const addr = opt(plan.addrEnv);
        if (!addr) {
            console.log(`- ${plan.name}: SKIP (${plan.addrEnv} not set)`);
            continue;
        }
        if ((await ethers.provider.getCode(addr)) === "0x") {
            console.log(`- ${plan.name} @ ${addr}: SKIP (no contract code on this network)`);
            continue;
        }

        if (plan.kind === "ownable") {
            const c = (await ethers.getContractAt(plan.artifact, addr)) as any;
            const owner: string = await c.owner();
            if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
                console.log(`- ${plan.name} @ ${addr}: SKIP (owner is ${owner}, not the deployer)`);
                continue;
            }
            console.log(`- ${plan.name} @ ${addr}: transferOwnership -> ${newAdmin}`);
            if (APPLY) {
                const tx = await c.transferOwnership(newAdmin);
                await tx.wait();
                console.log(`    ok (${tx.hash})`);
            }
            continue;
        }

        const c = (await ethers.getContractAt(plan.artifact, addr)) as any;
        for (const role of plan.roles) {
            const already = await c.hasRole(role, newAdmin);
            if (already) {
                console.log(`- ${plan.name} @ ${addr}: role ${role.slice(0, 10)} already held by new admin`);
            } else {
                console.log(`- ${plan.name} @ ${addr}: grantRole ${role.slice(0, 10)} -> ${newAdmin}`);
                if (APPLY) {
                    const tx = await c.grantRole(role, newAdmin);
                    await tx.wait();
                    console.log(`    granted (${tx.hash})`);
                }
            }
        }

        // Renounce deployer's roles LAST and only when explicitly requested.
        // DEFAULT_ADMIN_ROLE is renounced last so earlier renounces remain authorized.
        if (RENOUNCE && APPLY) {
            const ordered = [...plan.roles].sort((a, b) =>
                a === DEFAULT_ADMIN_ROLE ? 1 : b === DEFAULT_ADMIN_ROLE ? -1 : 0,
            );
            for (const role of ordered) {
                if (await c.hasRole(role, deployer.address)) {
                    const tx = await c.renounceRole(role, deployer.address);
                    await tx.wait();
                    console.log(`- ${plan.name}: deployer renounced ${role.slice(0, 10)} (${tx.hash})`);
                }
            }
        } else if (RENOUNCE && !APPLY) {
            console.log(`- ${plan.name}: would renounce deployer roles (dry-run)`);
        }
    }

    console.log("\nDone.", APPLY ? "" : "(dry-run — set APPLY=true to send transactions)");
    if (!RENOUNCE) {
        console.log(
            "Deployer roles retained. After verifying the multisig can operate every contract, re-run with RENOUNCE_DEPLOYER=true APPLY=true.",
        );
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
