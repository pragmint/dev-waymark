import { $ } from 'bun';
import { build } from 'bun';
import { globSync } from 'node:fs';
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const isProd = process.argv.includes('--prod');

// Always build frontend assets to public/
const files = globSync('src/frontend/scripts/*.ts');
await build({
  entrypoints: files,
  outdir: 'public',
  naming: '[dir]/[name].js',
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
  cpSync('resources', 'dist/resources', { recursive: true });
  cpSync('examples', 'dist/examples', { recursive: true });

  console.log('Production build complete. Run: cd dist && bun server.js');
}
