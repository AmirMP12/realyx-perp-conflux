import { execSync } from 'child_process';
import path from 'path';

const root = process.cwd();

try {
  console.log('🚀 Starting Realyx Build Process...');

  console.log('\n--- [1/3] Building Backend ---');
  execSync('npx tsc -p backend', { stdio: 'inherit', cwd: root });
  console.log('✅ Backend build complete.');

  console.log('\n--- [2/3] Type-checking Frontend ---');
  execSync('npx tsc -p frontend', { stdio: 'inherit', cwd: root });
  console.log('✅ Frontend type-check complete.');

  console.log('\n--- [3/3] Building Frontend Assets (Vite) ---');
  // We need to be careful with paths for Vite
  execSync('npx vite build frontend', { stdio: 'inherit', cwd: root });
  console.log('✅ Frontend assets built.');

  console.log('\n✨ Build successfully finished!');
} catch (error) {
  console.error('\n❌ Build failed during execution:');
  console.error(error.message);
  process.exit(1);
}
