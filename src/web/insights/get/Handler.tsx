import type { Context } from 'hono';
import { InsightsPage } from '../../../frontend/Pages/InsightsPage';
import type { Request } from '../../../application/insights/get/Request';
import type { InsightsPageData } from '../../../domain/prepareInsightsData';

export function create(handle: (req: Request) => Promise<InsightsPageData>) {
  return async (c: Context) => {
    const data = await handle({});
    return c.html(
      <InsightsPage
        teams={data.teams}
        metricOptions={data.metricOptions}
        capabilityMetricsJson={JSON.stringify(data.capabilityMetrics)}
        teamMetricsJson={JSON.stringify(data.teamMetrics)}
        availableDates={data.availableDates}
      />
    );
  };
}
