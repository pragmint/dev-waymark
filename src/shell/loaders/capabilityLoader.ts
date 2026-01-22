import { parse } from 'yaml';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Capability } from '../../core/data/capabilityTypes';
import { CapabilitySchema } from '../../core/data/capabilityTypes';
import { ValidationError } from '../../core/errors';
import { consoleLogger } from '../../core/logger';

// Pure I/O function - loads capabilities from filesystem with validation
export async function loadCapabilitiesFromFilesystem(): Promise<Capability[]> {
  const dir = 'resources/private/yaml/capabilities';
  const files = await readdir(dir);

  const capabilities = await Promise.all(
    files
      .filter(file => file.endsWith('.yaml'))
      .map(async file => {
        const filePath = join(dir, file);
        const content = await Bun.file(filePath).text();
        const raw = parse(content);

        try {
          // Parse with runtime validation
          return CapabilitySchema.parse(raw);
        } catch (error) {
          if (error instanceof z.ZodError) {
            const details = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            consoleLogger.error(`Validation error in ${file}`, { errors: error.errors });
            throw new ValidationError('Capability', file, details);
          }
          throw error;
        }
      })
  );

  consoleLogger.info(`Loaded ${capabilities.length} capabilities`);

  return capabilities;
}
