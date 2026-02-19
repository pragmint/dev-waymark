import { Context } from 'hono';
import { CapabilityCatalogPage } from '../frontend/Pages/CapabilityCatalogPage';
import { enrichCapabilitiesWithAssessment } from '../domain/capabilityAggregations';
import { enrichTeamsWithMetrics, enrichCapabilitiesWithMetrics } from '../domain/metricAggregations';
import { loadCapabilitiesFromFilesystem } from '../loaders/loadCapabilitiesFromFilesystem';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';
import { parseAssessmentMarkdown } from '../parsers/markdown/assessmentParser';

export async function handleCapabilityCatalog(c: Context) {
  const rawCapabilities = await loadCapabilitiesFromFilesystem();
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

  const rawTeams = await loadTeamsFromFilesystem();

  const assessmentData = await parseAssessmentMarkdown();
  const capabilitiesWithAssessment = await enrichCapabilitiesWithAssessment(
    rawCapabilities,
    assessmentData
  ); // should come from parsed capabilities instead
  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics); // why...

  // --- PURE TRANSFORMATION ---
  const capabilities = enrichCapabilitiesWithMetrics(
    capabilitiesWithAssessment,
    capabilityMetrics,
    teams
  );

  return c.html(<CapabilityCatalogPage teams={teams} allCapabilities={capabilities} />);
}
