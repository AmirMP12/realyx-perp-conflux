import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { ABI_OUTPUT_DIRS } from "./abi-output-dirs.js";

const __filename = fileURLToPath(import.meta.url);

const ENUM_REPLACEMENTS = [
    ['"type": "DataTypes.CollateralType"', '"type": "uint8"'],
    ['"type": "DataTypes.PosStatus"', '"type": "uint8"'],
    ['"internalType": "enum DataTypes.CollateralType"', '"internalType": "uint8"'],
    ['"internalType": "enum DataTypes.PosStatus"', '"internalType": "uint8"'],
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
        console.log("Fixed:", filePath);
    }
}

export function applyAbiEnumFixToAllExportedAbis() {
    for (const dir of ABI_OUTPUT_DIRS) {
        walkDir(dir, fixAbiInFile);
    }
}

const isMain =
    typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
    applyAbiEnumFixToAllExportedAbis();
    console.log("ABI enum fix done.");
}
