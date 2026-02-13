import { existsSync } from 'node:fs';

if (!existsSync('public/style.css')) {
  console.error('\nError: public/style.css not found. Run `bun b` first.\n');
  process.exit(1);
}

const proc = Bun.spawn(['bun', '--watch', 'index.tsx'], {
  stdio: ['inherit', 'inherit', 'inherit'],
});
await proc.exited;
