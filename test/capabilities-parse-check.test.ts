import { describe, test, expect } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { parseCapabilityMarkdown } from '../src/parsers/markdown/capabilityParser';

const CAPABILITIES_DIR = './resources/capabilities';

const files = (await readdir(CAPABILITIES_DIR)).filter(f => f.endsWith('.md'));

describe('parse all capability files', () => {
  test('capabilities directory has files', () => {
    expect(files.length).toBeGreaterThan(0);
    console.log(`Found ${files.length} capability files`);
  });

  for (const file of files) {
    test(`${file}`, async () => {
      const path = `${CAPABILITIES_DIR}/${file}`;
      const content = await Bun.file(path).text();
      const result = parseCapabilityMarkdown(content);

      expect(result.title).toBeTruthy();
      expect(result.doraLink).toBeTruthy();
      expect(result.introduction.length).toBeGreaterThan(0);
      expect(result.nuances.items.length).toBeGreaterThan(0);
      expect(result.assessment.ratings).toHaveLength(4);
      expect(result.supporting_practices.practices.length).toBeGreaterThan(0);
      expect(result.linked_capabilities.length).toBeGreaterThan(0);

      console.log(
        `  ✓ ${result.title}: ${result.nuances.items.length} nuances, ` +
          `${result.supporting_practices.practices.length} practices, ` +
          `${result.linked_capabilities.length} linked capabilities`
      );
    });
  }
});
