import type { FC, Child } from 'hono/jsx';
import { Layout } from './Layout';
import { Sidebar } from './Sidebar';
import type { Team } from '../../schemas/teamSchemas';

interface PageProps {
  title: string;
  heading: string;
  activePage: string;
  teams: Team[];
  children: Child;
}

export const Page: FC<PageProps> = ({ title, heading, activePage, teams, children }) => {
  return (
    <Layout title={title}>
      <Sidebar teams={teams} activePage={activePage} />
      <main class="main-content">
        <h1>{heading}</h1>
        {children}
      </main>
    </Layout>
  );
};
