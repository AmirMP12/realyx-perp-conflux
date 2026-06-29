import fs from "fs";
import path from "path";
import type { DeployResult } from "./deploy";

/**
 * Writes deployment result to deployment/<network>.json with contract addresses,
 * mock flags, and metadata useful for verification and post-deploy scripts.
 */
export function saveDeployment(
    networkName: string,
    result: DeployResult,
    chainId?: bigint,
    deploymentBlock?: number,
): string {
    const deploymentDir = path.join(process.cwd(), "deployment");
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const output = {
        network: networkName,
        chainId: chainId != null ? Number(chainId) : null,
        // Block height at deploy time. The keeper backfills from here on startup
        // so resting orders created before it launched are still discovered
        // (TradingCore exposes no pending-order enumeration).
        deploymentBlock: deploymentBlock != null ? Number(deploymentBlock) : null,
        timestamp: new Date().toISOString(),
        deployer: process.env.DEPLOYER_ADDRESS || null,
        contracts: {
            oracleAggregator: result.oracleAggregator,
            vaultCore: result.vaultCore,
            positionToken: result.positionToken,
            tradingCore: result.tradingCore,
            tradingCoreViews: result.tradingCoreViews,
            marketCalendar: result.marketCalendar,
            dividendManager: result.dividendManager,
            complianceManager: result.complianceManager,
            dividendKeeper: result.dividendKeeper,
            collateralRegistry: result.collateralRegistry,
            copyRegistry: result.copyRegistry,
            referralRegistry: result.referralRegistry,
            usdt0: result.usdt0,
            pyth: result.pyth,
            ...(result.mockUsdt0 ? { mockUsdt0: result.mockUsdt0 } : {}),
            ...(result.mockPyth ? { mockPyth: result.mockPyth } : {}),
        },
        flags: {
            usdt0IsMock: result.usdt0IsMock,
            pythIsMock: result.pythIsMock,
        },
    };

    const filePath = path.join(deploymentDir, `${networkName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(output, null, 2), "utf8");
    return filePath;
}

/**
 * Load a previous deployment from disk.
 * Returns null if the file doesn't exist.
 */
export function loadDeployment(networkName: string): ReturnType<typeof JSON.parse> | null {
    const filePath = path.join(process.cwd(), "deployment", `${networkName}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Merge additional contract addresses into deployment/<network>.json without
 * disturbing the rest of the file. Used by standalone deploy scripts (e.g.
 * KeeperNetwork, RedStoneAdapter) that run after the main deploy so their
 * addresses become discoverable through the same deployment file that the
 * keeper/liquidation bots and setup scripts read via `loadDeployment`.
 *
 * Creates the file (and directory) with a minimal shape if it doesn't exist yet.
 */
export function updateDeploymentContracts(networkName: string, patch: Record<string, string>): string {
    const deploymentDir = path.join(process.cwd(), "deployment");
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const filePath = path.join(deploymentDir, `${networkName}.json`);
    const existing = fs.existsSync(filePath)
        ? (JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>)
        : { network: networkName };

    const contracts = {
        ...(typeof existing.contracts === "object" && existing.contracts !== null ? existing.contracts : {}),
        ...patch,
    };
    const output = { ...existing, network: networkName, contracts };

    fs.writeFileSync(filePath, JSON.stringify(output, null, 2), "utf8");
    return filePath;
}
