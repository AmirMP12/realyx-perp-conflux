import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const root = process.cwd();

function run(cmd, desc, options = {}) {
  const cwd = options.cwd ?? root;
  console.log(`\n--- ${desc} ---`);
  try {
    // Capture output so we can see it even if the process fails
    const output = execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', cwd });
    console.log(output);
    console.log(`✅ ${desc} successful.`);
  } catch (error) {
    console.error(`❌ ${desc} FAILED!`);
    console.error('--- ERROR OUTPUT ---');
    console.error(error.stdout);
    console.error(error.stderr);
    console.error('-------------------');
    process.exit(1);
  }
}

try {
  console.log('🚀 Starting Realyx Verbose Build Process...');

  run('npx tsc -p backend', '[1/3] Building Backend');
  run('npx tsc -p frontend', '[2/3] Type-checking Frontend');
  run('npx vite build', '[3/3] Building Frontend Assets (Vite)', {
    cwd: path.join(root, 'frontend'),
  });

  console.log('\n--- Preparing Backend Runtime Metadata ---');
  const backendDistDir = path.join(root, 'backend', 'dist');
  fs.mkdirSync(backendDistDir, { recursive: true });
  fs.writeFileSync(
    path.join(backendDistDir, 'package.json'),
    JSON.stringify({ type: 'module' }, null, 2),
    'utf-8'
  );
  console.log('✅ Wrote backend/dist/package.json with type=module.');
  
  console.log('\n--- Standardizing Output ---');
  if (process.platform === 'win32') {
    run('xcopy /E /I /Y frontend\\dist public', 'Copying assets to root public folder (Windows)');
  } else {
    run('mkdir -p public && cp -rf frontend/dist/. public/', 'Copying assets to root public folder (Linux)');
  }

  console.log('\n--- Build Output Audit ---');
  run('ls -R public', 'Verifying root public contents');

  console.log('\n✨ Build successfully finished!');
} catch (error) {
  console.error('\n❌ Unexpected error in build runner:');
  console.error(error);
  process.exit(1);
}
