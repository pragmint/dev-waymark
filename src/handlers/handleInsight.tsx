import { Context } from "hono";
import { prepareInsightsData } from "../pages/handlers/InsightsHandler";
import { InsightsPage } from "../pages/InsightsPage";
import { loadDataContext } from "../loaders/loadDataContext";

const { capabilities, teams, teamMetrics, capabilityMetrics } = await loadDataContext()

export function handleInsight(c: Context) {
  const insightsData = prepareInsightsData(teams, capabilities, capabilityMetrics, teamMetrics);

  return c.html(
    <InsightsPage
      teams={insightsData.teams}
      metricOptions={insightsData.metricOptions}
      capabilityMetricsJson={JSON.stringify(insightsData.capabilityMetrics)}
      teamMetricsJson={JSON.stringify(insightsData.teamMetrics)}
      availableDates={insightsData.availableDates}
    />
  );
};
