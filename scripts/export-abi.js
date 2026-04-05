import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts", "contracts");
const ABI_OUT_DIRS = [
    path.join(__dirname, "..", "abi"),
    path.join(__dirname, "..", "subgraph", "abis"),
];

function walkDir(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            walkDir(full, fileList);
        } else if (e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".dbg.json")) {
            fileList.push(full);
        }
    }
    return fileList;
}

if (!fs.existsSync(ARTIFACTS_DIR)) {
    console.error("Artifacts not found. Run: npx hardhat compile");
    process.exit(1);
}

for (const outDir of ABI_OUT_DIRS) {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
}

const files = walkDir(ARTIFACTS_DIR);
let count = 0;
for (const filePath of files) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const art = JSON.parse(raw);
        const name = art.contractName;
        const abi = art.abi;
        if (!name || !Array.isArray(abi)) continue;

        for (const outDir of ABI_OUT_DIRS) {
            const outPath = path.join(outDir, `${name}.json`);
            fs.writeFileSync(outPath, JSON.stringify(abi, null, 2), "utf8");
        }
        count++;
        console.log(name);
    } catch (e) {
        console.warn("Skip", filePath, e.message);
    }
}
console.log(`\nExported ${count} ABIs to: \n - ${ABI_OUT_DIRS.join("\n - ")}`);
