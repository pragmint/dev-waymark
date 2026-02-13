import { existsSync } from 'node:fs';

if (!existsSync('dist')) {
  console.error('\nError: dist/ folder not found. Run `bun build:prod` first.\n');
  process.exit(1);
}

const proc = Bun.spawn(['bun', './dist/server.js'], {
  stdio: ['inherit', 'inherit', 'inherit'],
});
await proc.exited;
