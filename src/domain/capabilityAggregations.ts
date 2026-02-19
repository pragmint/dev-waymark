import type { Capability } from '../schemas/capabilitySchemas';
import { parseAssessmentMarkdown } from '../parsers/markdown/assessmentParser';

/**
 * Enriches capabilities with maturity level descriptions from the assessment markdown
 */
export async function enrichCapabilitiesWithAssessment(
  capabilities: Capability[]
): Promise<Capability[]> {
  const assessmentData = await parseAssessmentMarkdown();

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
