import { parse } from "yaml";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Capability } from "../../core/data/capabilityTypes";

// Pure I/O function - loads capabilities from filesystem
export async function loadCapabilitiesFromFilesystem(): Promise<Capability[]> {
  const dir = "resources/private/yaml/capabilities";
  const files = await readdir(dir);

  const capabilities = await Promise.all(
    files
      .filter(file => file.endsWith('.yaml'))
      .map(async (file) => {
        const filePath = join(dir, file);
        const content = await Bun.file(filePath).text();
        return parse(content) as Capability;
      })
  );

  console.log(`Loaded ${capabilities.length} capabilities`);

  return capabilities;
}
