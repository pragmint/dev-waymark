import { Context } from 'hono';
import { ExperimentDetailPage } from '../frontend/Pages/ExperimentDetailPage';
import { prepareExperimentDetailData } from '../frontend/Pages/handlers/ExperimentDetailHandler';
import { loadDataContext } from '../loaders/loadDataContext';

const { enrichedExperiments, teams } = await loadDataContext();

export async function handleExperimentDetail(c: Context) {
  const experimentId = c.req.param('experimentId');
  const data = await prepareExperimentDetailData(experimentId, teams, enrichedExperiments);
  return c.html(<ExperimentDetailPage {...data} />);
}
