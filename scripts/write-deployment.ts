import fs from "fs";
import path from "path";
import type { DeployResult } from "./deploy";

/**
 * Writes deployment result to deployment/<network>.json with contract addresses.
 * Uses process.cwd() (project root) so the folder is created in the repo regardless of how the script is run.
 */
export function saveDeployment(
    networkName: string,
    result: DeployResult,
    chainId?: bigint
): string {
    const deploymentDir = path.join(process.cwd(), "deployment");
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const output = {
        network: networkName,
        chainId: chainId != null ? Number(chainId) : null,
        timestamp: new Date().toISOString(),
        contracts: result,
    };

    const filePath = path.join(deploymentDir, `${networkName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(output, null, 2), "utf8");
    return filePath;
}
