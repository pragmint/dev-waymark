import type { Team, TeamIdentity } from '../../schemas/teamSchemas';

export interface TeamsRepository {
  listAll(): Promise<Team[]>;
  listIdentities(): Promise<TeamIdentity[]>;
}
