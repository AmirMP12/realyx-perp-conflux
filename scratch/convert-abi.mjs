import fs from 'fs';

const tcJson = fs.readFileSync('backend/src/abi/TradingCore.json.bak', 'utf8');
const vcJson = fs.readFileSync('backend/src/abi/VaultCore.json.bak', 'utf8');

fs.writeFileSync('backend/src/abi/TradingCore.ts', `export default ${tcJson};`, 'utf8');
fs.writeFileSync('backend/src/abi/VaultCore.ts', `export default ${vcJson};`, 'utf8');

console.log('✅ Converted ABIs to UTF-8 TypeScript modules successfully.');
