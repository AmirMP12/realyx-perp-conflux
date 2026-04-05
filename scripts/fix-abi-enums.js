import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts", "contracts");

const ENUM_REPLACEMENTS = [
    ['"type": "DataTypes.CollateralType"', '"type": "uint8"'],
    ['"type": "DataTypes.PosStatus"', '"type": "uint8"'],
];

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkDir(full, callback);
        else if (e.name.endsWith(".json")) callback(full);
    }
}

function fixAbiInFile(filePath) {
    let content = fs.readFileSync(filePath, "utf8");
    let changed = false;
    for (const [from, to] of ENUM_REPLACEMENTS) {
        if (content.includes(from)) {
            content = content.split(from).join(to);
            changed = true;
        }
    }
    if (changed) {
        fs.writeFileSync(filePath, content, "utf8");
        console.log("Fixed:", path.relative(ARTIFACTS_DIR, filePath));
    }
}

walkDir(ARTIFACTS_DIR, fixAbiInFile);
console.log("ABI enum fix done.");
