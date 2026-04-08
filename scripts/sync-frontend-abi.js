import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USE_PROGRAM_PATH = path.join(__dirname, "..", "frontend", "src", "hooks", "useProgram.ts");
const frontendAbiDir = path.join(__dirname, "..", "frontend", "src", "abi");

function updateAbi(contractName, constantName) {
    const abiPath = path.join(__dirname, "..", "backend", "abi", `${contractName}.json`);
    const targetPath = path.join(frontendAbiDir, `${contractName}.json`);
    const abiRaw = fs.readFileSync(abiPath, "utf8");
    const jsonStr = JSON.stringify(JSON.parse(abiRaw), null, 4);

    let content = fs.readFileSync(USE_PROGRAM_PATH, "utf8");
    const regex = new RegExp(`export const ${constantName} = \\[.*?\\] as const;`, "s");
    content = content.replace(regex, `export const ${constantName} = ${jsonStr} as const;`);
    fs.writeFileSync(USE_PROGRAM_PATH, content);
    console.log(`Updated ${constantName} in useProgram.ts`);
}

try {
    updateAbi("TradingCore", "TRADING_CORE_ABI");
    updateAbi("VaultCore", "VAULT_ABI");
    updateAbi("OracleAggregator", "ORACLE_ABI");
} catch (e) {
    console.error(e);
}
