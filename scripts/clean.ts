import { rmSync } from 'node:fs';

const dirs = [
  'public',
  'dist',
  'playwright-report',
  'test-results',
  'blob-report',
  'localhost:3000',
];

for (const dir of dirs) {
  rmSync(dir, { recursive: true, force: true });
  console.log(`Removed ${dir}/`);
}
