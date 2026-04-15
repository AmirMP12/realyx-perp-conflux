import dotenv from "dotenv";
import fs from "fs";
import path from "path";
const cwd = process.cwd();
const paths = [
    { name: "cwd", path: path.join(cwd, ".env") },
    { name: "backend", path: path.join(cwd, "backend", ".env") },
    { name: "root", path: path.join(cwd, "..", ".env") },
];
for (const p of paths) {
    const resolved = path.resolve(p.path);
    if (fs.existsSync(resolved)) {
        dotenv.config({ path: resolved });
    }
}
function defaultRpcUrl() {
    const id = parseInt(process.env.CHAIN_ID ?? "71", 10);
    if (id === 1030)
        return "https://evm.confluxrpc.com";
    return "https://evmtestnet.confluxrpc.com";
}
export const config = {
    port: parseInt(process.env.PORT ?? "3001", 10),
    wsPort: parseInt(process.env.WS_PORT ?? "3002", 10),
    postgresUrl: process.env.POSTGRES_URL,
    chainId: parseInt(process.env.CHAIN_ID ?? "71", 10),
    /** Conflux eSpace JSON-RPC; default matches hardhat `confluxTestnet` when unset. */
    rpcUrl: (process.env.RPC_URL ?? "").trim() || defaultRpcUrl(),
    nodeEnv: process.env.NODE_ENV ?? "development",
    metricsPort: parseInt(process.env.METRICS_PORT ?? "9090", 10),
};
