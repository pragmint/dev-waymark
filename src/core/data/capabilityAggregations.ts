import type { Capability, TrendDirection } from "./capabilityTypes";
import type { Team } from "./teamTypes";

// Pure aggregation function - returns new enriched capabilities array
export function enrichCapabilitiesWithTeamData(
  capabilities: Capability[],
  teams: Team[]
): Capability[] {
  // Build a map of capability scores from all teams (both targeted and non-targeted)
  const capabilityScores = new Map<string, { scores: number[], trends: TrendDirection[], teamCount: number }>();

  teams.forEach(team => {
    // Combine targeted and non-targeted capabilities
    const allCapabilities = [
      ...(team.targetedCapabilities || []),
      ...(team.nonTargetedCapabilities || [])
    ];

    allCapabilities.forEach((tc) => {
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
    team.targetedCapabilities?.forEach((tc) => {
      targetingCounts.set(tc.id, (targetingCounts.get(tc.id) || 0) + 1);
    });
  });

  // Return new array with enriched capabilities
  return capabilities.map(capability => {
    const scoreData = capabilityScores.get(capability.id);

    if (scoreData && scoreData.scores.length > 0) {
      // Calculate average score across all teams
      const avgScore = scoreData.scores.reduce((a, b) => a + b, 0) / scoreData.scores.length;
      const currentScore = Math.round(avgScore * 10) / 10; // Round to 1 decimal

      // Count teams actively targeting this capability
      const teamsTargeting = targetingCounts.get(capability.id) || 0;

      // Determine overall trend (majority wins, up takes precedence over stable over down)
      const trendCounts = { up: 0, stable: 0, down: 0 };
      scoreData.trends.forEach(trend => trendCounts[trend]++);

      let trend: TrendDirection;
      if (trendCounts.up >= trendCounts.stable && trendCounts.up >= trendCounts.down) {
        trend = "up";
      } else if (trendCounts.down > trendCounts.stable) {
        trend = "down";
      } else {
        trend = "stable";
      }

      return {
        ...capability,
        currentScore,
        teamsTargeting,
        trend
      };
    } else {
      // No teams have this capability
      return {
        ...capability,
        teamsTargeting: 0,
        currentScore: 0,
        trend: "stable" as TrendDirection
      };
    }
  });
}
