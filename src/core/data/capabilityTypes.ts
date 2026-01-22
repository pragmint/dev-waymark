// Re-export types from schemas (for backward compatibility)
export type { TrendDirection, CapabilityCategory, Capability } from './capabilitySchemas';

// Re-export schemas for validation
export {
  TrendDirectionSchema,
  CapabilityCategorySchema,
  CapabilitySchema,
} from './capabilitySchemas';
