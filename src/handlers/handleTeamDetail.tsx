import { Context } from "hono";
import { prepareTeamDetailData } from "../pages/handlers/TeamDetailHandler";
import { TeamDetailPage } from "../pages/TeamDetailPage";
import { loadDataContext } from "../loaders/loadDataContext";

const { enrichedExperiments, capabilities, teams, teamMetrics, capabilityMetrics } = await loadDataContext()

export async function handleTeamDetail(c: Context) {
  const teamId = c.req.param('teamId');
  const data = await prepareTeamDetailData(
    teamId,
    teams,
    capabilities,
    capabilityMetrics,
    enrichedExperiments,
    teamMetrics
  );

  return c.html(<TeamDetailPage {...data} />);
};
