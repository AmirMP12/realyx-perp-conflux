#!/usr/bin/env node

const { spawnSync } = require("child_process");
const deployKey = process.env.GRAPH_STUDIO_DEPLOY_KEY;
const args = ["deploy", "--studio"];
if (deployKey) {
  args.push("--deploy-key", deployKey);
}
const r = spawnSync("npx", ["graph", ...args], {
  stdio: "inherit",
  shell: true,
});
process.exit(r.status || 0);
