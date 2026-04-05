const fs = require("fs");
const path = require("path");

const generatedDir = path.join(__dirname, "..", "src", "generated");
const dirs = ["TradingCore", "VaultCore", "OracleAggregator", "PositionToken", "DividendManager"];

for (const dir of dirs) {
  const filePath = path.join(generatedDir, dir, `${dir}.ts`);
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, "utf8");
  const hasAddress = /ethereum\.Address/.test(content);
  const hasBigInt = /ethereum\.BigInt/.test(content);
  if (!hasAddress && !hasBigInt) continue;
  if (content.startsWith('import { ethereum } from "@graphprotocol/graph-ts";')) {
    const imports = ["ethereum"];
    if (hasAddress) imports.unshift("Address");
    if (hasBigInt) imports.unshift("BigInt");
    content = content.replace(
      'import { ethereum } from "@graphprotocol/graph-ts";',
      `import { ${imports.join(", ")} } from "@graphprotocol/graph-ts";`
    );
  }
  content = content.replace(/ethereum\.BigInt/g, "BigInt");
  content = content.replace(/ethereum\.Address/g, "Address");
  fs.writeFileSync(filePath, content);
  console.log("Fixed:", filePath);
}

console.log("fix-generated-types done.");
