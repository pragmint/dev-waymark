import { $ } from 'bun';
import { build } from 'bun';
import { globSync } from 'glob';
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const isProd = process.argv.includes('--prod');

// Clean public directory before building to avoid stale files
rmSync('public', { recursive: true, force: true });
mkdirSync('public', { recursive: true });

// Always build frontend assets to public/
const files = globSync('src/frontend/scripts/*.ts', { ignore: '**/*.test.ts' });
await build({
  entrypoints: files,
  outdir: 'public',
  naming: '[name].js',
});
await $`sass src/styles/main.scss:public/style.css`;

// Production: bundle server + assemble dist/
if (isProd) {
  rmSync('dist', { recursive: true, force: true });
  mkdirSync('dist', { recursive: true });

  await build({
    entrypoints: ['./index.tsx'],
    outdir: './dist',
    target: 'bun',
    naming: 'server.js',
  });

  cpSync('public', 'dist/public', { recursive: true });

  console.log('Production build complete. Run: cd dist && bun server.js');
}
