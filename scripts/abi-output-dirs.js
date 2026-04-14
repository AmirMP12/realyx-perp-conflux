import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/** Canonical dirs for exported Hardhat ABIs (JSON). Kept in sync by `export-abi.js`. */
export const ABI_OUTPUT_DIRS = [path.join(root, "backend", "src", "abi"), path.join(root, "frontend", "src", "abi")];
