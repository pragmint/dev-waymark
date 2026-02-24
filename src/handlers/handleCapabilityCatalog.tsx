import { Context } from 'hono';
import { CapabilityCatalogPage } from '../frontend/Pages/CapabilityCatalogPage';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../domain/metricAggregations';
import { loadAndParseCapabilities } from '../loaders/loadAndParseCapabilities';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';

export async function handleCapabilityCatalog(c: Context) {
  const capabilitiesWithAssessment = await loadAndParseCapabilities();
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

  const rawTeams = await loadTeamsFromFilesystem();

  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

  // --- PURE TRANSFORMATION ---
  const capabilities = enrichCapabilitiesWithMetrics(
    capabilitiesWithAssessment,
    capabilityMetrics,
    teams
  );

  return c.html(<CapabilityCatalogPage allCapabilities={capabilities} />);
}
