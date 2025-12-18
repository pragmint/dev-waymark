import { parse } from "yaml";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { TrendDirection } from "./capabilities";

export interface ActiveExperiment {
  practiceId: string;
  startDate: string;
  hypothesis: string;
  status: "in-progress" | "blocked" | "paused";
}

export interface TeamCapability {
  id: string;
  currentScore: number;
  trend: TrendDirection;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  targetedCapabilities: TeamCapability[];
  nonTargetedCapabilities: TeamCapability[];
  activeExperiments: ActiveExperiment[];
}

let teams: Team[] = [];

// Load teams from YAML files
export async function loadTeams(): Promise<void> {
  const dir = "resources/private/yaml/teams";
  const files = await readdir(dir);

  teams = await Promise.all(
    files
      .filter(file => file.endsWith('.yaml'))
      .map(async (file) => {
        const filePath = join(dir, file);
        const content = await Bun.file(filePath).text();
        return parse(content) as Team;
      })
  );

  // Sort teams alphabetically by name
  teams.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Loaded ${teams.length} teams`);
}

export function getAllTeams(): Team[] {
  return teams;
}

export function getTeamById(id: string): Team | undefined {
  return teams.find(t => t.id === id);
}
