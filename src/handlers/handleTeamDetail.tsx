import { Context } from 'hono';
import { TeamDetailPage } from '../frontend/Pages/TeamDetailPage';
import { loadDataContext } from '../loaders/loadDataContext';
import { prepareTeamDetailData } from '../core/domain/prepareTeamDetailData';

const { enrichedExperiments, capabilities, teams, teamMetrics, capabilityMetrics } =
  await loadDataContext();

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
}
