import { Context } from 'hono';
import { loadDataContext } from '../loaders/loadDataContext';
import { prepareOverviewData } from '../domain/prepareOverviewData';
import { OverviewPage } from '../frontend/Pages/OverviewPage';

const { capabilities, summaries, teams } = await loadDataContext();

export const handleOverview = (c: Context) => {
  const date = c.req.param('date');
  if (date === undefined) {
    const data = prepareOverviewData(teams, capabilities, summaries);
    return c.html(<OverviewPage {...data} />);
  } else {
    const data = prepareOverviewData(teams, capabilities, summaries, date);
    return c.html(<OverviewPage {...data} />);
  }
};
