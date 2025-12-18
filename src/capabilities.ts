import { parse } from "yaml";
import { glob } from "glob";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type TrendDirection = "up" | "down" | "stable";

export type CapabilityCategory =
  | "Climate for Learning"
  | "Fast Flow"
  | "Fast Feedback";

export interface Capability {
  id: string;
  name: string;
  category: CapabilityCategory;
  currentScore: number; // 0-4
  trend: TrendDirection;
  teamsTargeting: number;
  description?: string;
}

let capabilities: Capability[] = [];
let teamsData: any[] = [];

// Load capabilities from YAML files
export async function loadCapabilities(): Promise<void> {
  const dir = "resources/private/yaml/capabilities";
  const files = await readdir(dir);

  capabilities = await Promise.all(
    files
      .filter(file => file.endsWith('.yaml'))
      .map(async (file) => {
        const filePath = join(dir, file);
        const content = await Bun.file(filePath).text();
        return parse(content) as Capability;
      })
  );

  console.log(`Loaded ${capabilities.length} capabilities`);
}

// Set teams data and recalculate capability scores based on team averages
export function updateCapabilitiesFromTeams(teams: any[]): void {
  teamsData = teams;

  // Build a map of capability scores from all teams (both targeted and non-targeted)
  const capabilityScores = new Map<string, { scores: number[], trends: TrendDirection[], teamCount: number }>();

  teams.forEach(team => {
    // Combine targeted and non-targeted capabilities
    const allCapabilities = [
      ...(team.targetedCapabilities || []),
      ...(team.nonTargetedCapabilities || [])
    ];

    allCapabilities.forEach((tc: any) => {
      if (!capabilityScores.has(tc.id)) {
        capabilityScores.set(tc.id, { scores: [], trends: [], teamCount: 0 });
      }
      const data = capabilityScores.get(tc.id)!;
      data.scores.push(tc.currentScore);
      data.trends.push(tc.trend);
      data.teamCount++;
    });
  });

  // Count teams that are actively targeting each capability
  const targetingCounts = new Map<string, number>();
  teams.forEach(team => {
    team.targetedCapabilities?.forEach((tc: any) => {
      targetingCounts.set(tc.id, (targetingCounts.get(tc.id) || 0) + 1);
    });
  });

  // Update capabilities with averaged scores
  capabilities.forEach(capability => {
    const scoreData = capabilityScores.get(capability.id);
    if (scoreData && scoreData.scores.length > 0) {
      // Calculate average score across all teams
      const avgScore = scoreData.scores.reduce((a, b) => a + b, 0) / scoreData.scores.length;
      capability.currentScore = Math.round(avgScore * 10) / 10; // Round to 1 decimal

      // Count teams actively targeting this capability
      capability.teamsTargeting = targetingCounts.get(capability.id) || 0;

      // Determine overall trend (majority wins, up takes precedence over stable over down)
      const trendCounts = { up: 0, stable: 0, down: 0 };
      scoreData.trends.forEach(trend => trendCounts[trend]++);

      if (trendCounts.up >= trendCounts.stable && trendCounts.up >= trendCounts.down) {
        capability.trend = "up";
      } else if (trendCounts.down > trendCounts.stable) {
        capability.trend = "down";
      } else {
        capability.trend = "stable";
      }
    } else {
      // No teams have this capability
      capability.teamsTargeting = 0;
      capability.currentScore = 0;
      capability.trend = "stable";
    }
  });
}

export function getAllCapabilities(): Capability[] {
  return capabilities;
}

export function getTopThreeCapabilities(): Capability[] {
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

export function getAllCapabilitiesAlphabetically(): Capability[] {
  return [...capabilities].sort((a, b) => a.name.localeCompare(b.name));
}

export function getCapabilitiesByCategory(): Record<CapabilityCategory, Capability[]> {
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

export function getCapabilityById(id: string): Capability | undefined {
  return capabilities.find(c => c.id === id);
}
