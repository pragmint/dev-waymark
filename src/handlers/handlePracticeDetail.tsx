import { Context } from 'hono';
import { PracticeDetailPage } from '../frontend/Pages/PracticeDetailPage';
import { loadPracticeFromFilesystem } from '../loaders/loadPracticeFromFilesystem';
import { NotFoundError } from '../domain/errors';
import { enrichTeamsWithMetrics } from '../domain/metricAggregations';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';

export async function handlePracticeDetail(c: Context) {
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();
  const rawTeams = await loadTeamsFromFilesystem();
  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);
  const practiceId = c.req.param('practiceId');
  const practice = await loadPracticeFromFilesystem(practiceId);

  if (!practice) {
    throw new NotFoundError('Practice', practiceId);
  }

  return c.html(<PracticeDetailPage teams={teams} practice={practice} />);
}
