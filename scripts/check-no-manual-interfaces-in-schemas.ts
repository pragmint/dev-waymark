/**
 * Fitness function: no manual `interface` declarations in src/schemas/
 *
 * All types in src/schemas/ must be derived via z.infer<typeof SomeSchema>.
 * Manual interfaces risk diverging from the Zod schema they're meant to reflect.
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';

const schemaFiles = globSync('src/schemas/*.ts');

const violations: { file: string; line: number; text: string }[] = [];

for (const file of schemaFiles) {
  const lines = readFileSync(file, 'utf-8').split('\n');
  lines.forEach((text, i) => {
    if (/^\s*export\s+interface\s+/.test(text)) {
      violations.push({ file, line: i + 1, text: text.trim() });
    }
  });
}

if (violations.length > 0) {
  console.error(
    'Manual interface declarations found in src/schemas/ — use z.infer<typeof Schema> instead:\n'
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

console.log(`Checked ${schemaFiles.length} schema files — no manual interfaces found.`);
