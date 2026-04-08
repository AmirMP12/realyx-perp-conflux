import fs from "fs";
import path from "path";
import type { DeployResult } from "./deploy";

/**
 * Writes deployment result to deployment/<network>.json with contract addresses,
 * mock flags, and metadata useful for verification and post-deploy scripts.
 */
export function saveDeployment(networkName: string, result: DeployResult, chainId?: bigint): string {
    const deploymentDir = path.join(process.cwd(), "deployment");
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const output = {
        network: networkName,
        chainId: chainId != null ? Number(chainId) : null,
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
            usdc: result.usdc,
            pyth: result.pyth,
            ...(result.mockUsdc ? { mockUsdc: result.mockUsdc } : {}),
            ...(result.mockPyth ? { mockPyth: result.mockPyth } : {}),
        },
        flags: {
            usdcIsMock: result.usdcIsMock,
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
