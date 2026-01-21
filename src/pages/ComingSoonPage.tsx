import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../core/data/teamTypes';

interface ComingSoonPageProps {
  teams: Team[];
  title: string;
  heading: string;
  activePage: string;
}

export const ComingSoonPage: FC<ComingSoonPageProps> = ({ teams, title, heading, activePage }) => {
  return (
    <Page title={title} heading={heading} activePage={activePage} teams={teams}>
      <p>This page is coming soon.</p>
    </Page>
  );
};
