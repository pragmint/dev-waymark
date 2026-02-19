import type { Capability, MaturityLevel } from '../schemas/capabilitySchemas';

/**
 * Enriches capabilities with maturity level descriptions from the assessment markdown
 */
export async function enrichCapabilitiesWithAssessment(
  capabilities: Capability[],
  assessmentData: Map<string, MaturityLevel[]>
): Promise<Capability[]> {
  return capabilities.map(capability => {
    const maturityLevels = assessmentData.get(capability.id);
    if (maturityLevels) {
      return {
        ...capability,
        maturityLevels,
      };
    }
    return capability;
  });
}
