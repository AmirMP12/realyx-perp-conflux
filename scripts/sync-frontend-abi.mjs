import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE = ["TradingCore", "VaultCore", "OracleAggregator"];

const backendAbiDir = path.join(__dirname, "..", "backend", "src", "abi");
const frontendAbiDir = path.join(__dirname, "..", "frontend", "src", "abi");

if (!fs.existsSync(backendAbiDir)) {
    console.error("Missing backend/src/abi. Run: npx hardhat compile && npm run export-abi");
    process.exit(1);
}

if (!fs.existsSync(frontendAbiDir)) fs.mkdirSync(frontendAbiDir, { recursive: true });

for (const name of CORE) {
    const src = path.join(backendAbiDir, `${name}.json`);
    if (!fs.existsSync(src)) {
        console.error(`Missing ${src}`);
        process.exit(1);
    }
    const dst = path.join(frontendAbiDir, `${name}.json`);
    fs.copyFileSync(src, dst);
    console.log(`Copied ${name}.json -> ${path.relative(path.join(__dirname, ".."), dst)}`);
}

console.log("Done.");
