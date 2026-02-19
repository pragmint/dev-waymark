import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';

interface ComingSoonPageProps {
  title: string;
  heading: string;
  activePage: string;
}

export const ComingSoonPage: FC<ComingSoonPageProps> = ({ title, heading, activePage }) => {
  return (
    <Page title={title} heading={heading} activePage={activePage}>
      <p>This page is coming soon.</p>
    </Page>
  );
};
