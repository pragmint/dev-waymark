import { Context } from 'hono';
import { PracticesCatalogPage } from '../frontend/Pages/PracticesCatalogPage';
import { loadPracticesFromFilesystem } from '../loaders/loadPracticesFromFilesystem';
import { enrichTeamsWithMetrics } from '../domain/metricAggregations';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';

export async function handlePracticeCatalog(c: Context) {
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();
  const rawTeams = await loadTeamsFromFilesystem();
  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);
  const practices = await loadPracticesFromFilesystem();

  return c.html(<PracticesCatalogPage teams={teams} practices={practices} />);
}
