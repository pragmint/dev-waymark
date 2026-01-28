import type { Capability } from './capabilityTypes';

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

export function getAllCapabilities(capabilities: Capability[]): Capability[] {
  // Return all capabilities sorted alphabetically by name
  return [...capabilities].sort((a, b) => a.name.localeCompare(b.name));
}
