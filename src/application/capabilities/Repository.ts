import type { Capability } from '../../schemas/capabilitySchemas';

export interface CapabilitiesRepository {
  listAll(): Promise<Capability[]>;
  getMarkdown(id: string): Promise<string | null>;
}
