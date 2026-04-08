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

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  wsPort: parseInt(process.env.WS_PORT ?? "3002", 10),
  postgresUrl: process.env.POSTGRES_URL,
  chainId: parseInt(process.env.CHAIN_ID ?? "71", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  metricsPort: parseInt(process.env.METRICS_PORT ?? "9090", 10),
} as const;
