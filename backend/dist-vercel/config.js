"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const cwd = process.cwd();
const paths = [
    { name: "cwd", path: path_1.default.join(cwd, ".env") },
    { name: "backend", path: path_1.default.join(cwd, "backend", ".env") },
    { name: "root", path: path_1.default.join(cwd, "..", ".env") },
];
for (const p of paths) {
    const resolved = path_1.default.resolve(p.path);
    if (fs_1.default.existsSync(resolved)) {
        dotenv_1.default.config({ path: resolved });
    }
}
function defaultRpcUrl() {
    const id = parseInt(process.env.CHAIN_ID ?? "71", 10);
    if (id === 1030)
        return "https://evm.confluxrpc.com";
    return "https://evmtestnet.confluxrpc.com";
}
exports.config = {
    port: parseInt(process.env.PORT ?? "3001", 10),
    wsPort: parseInt(process.env.WS_PORT ?? "3002", 10),
    postgresUrl: process.env.POSTGRES_URL,
    chainId: parseInt(process.env.CHAIN_ID ?? "71", 10),
    /** Conflux eSpace JSON-RPC; default matches hardhat `confluxTestnet` when unset. */
    rpcUrl: (process.env.RPC_URL ?? "").trim() || defaultRpcUrl(),
    nodeEnv: process.env.NODE_ENV ?? "development",
    metricsPort: parseInt(process.env.METRICS_PORT ?? "9090", 10),
};
