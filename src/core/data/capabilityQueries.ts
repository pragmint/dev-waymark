import type { Capability, CapabilityCategory } from "./capabilityTypes";

// Pure query functions - no I/O, no mutation

export function findCapabilityById(capabilities: Capability[], id: string): Capability | undefined {
  return capabilities.find(c => c.id === id);
}

export function getTopThreeCapabilities(capabilities: Capability[]): Capability[] {
  // Return the top 3 capabilities by current score, with ties broken by teams targeting
  return [...capabilities]
    .sort((a, b) => {
      if (b.currentScore !== a.currentScore) {
        return b.currentScore - a.currentScore;
      }
      return b.teamsTargeting - a.teamsTargeting;
    })
    .slice(0, 3);
}

export function groupCapabilitiesByCategory(capabilities: Capability[]): Record<CapabilityCategory, Capability[]> {
  const result: Record<CapabilityCategory, Capability[]> = {
    "Climate for Learning": [],
    "Fast Flow": [],
    "Fast Feedback": [],
  };

  capabilities.forEach(cap => {
    result[cap.category].push(cap);
  });

  // Sort each category alphabetically
  Object.keys(result).forEach(key => {
    result[key as CapabilityCategory].sort((a, b) => a.name.localeCompare(b.name));
  });

  return result;
}
