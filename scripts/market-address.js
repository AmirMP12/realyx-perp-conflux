const { ethers } = require("ethers");

const symbol = (process.argv[2] || "TSLA").toUpperCase();
const namespace = "realyx/market/";
const input = namespace + symbol;
const hash = ethers.keccak256(ethers.toUtf8Bytes(input));
const address = "0x" + hash.slice(-40).toLowerCase();

console.log("Symbol:", symbol);
console.log("Market address:", address);
console.log("");
console.log("Use in .env:");
console.log("MARKET_ADDRESS=" + address);
console.log("MARKET_ID=" + symbol + "-USD");
