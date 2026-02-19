import type { FC, Child } from 'hono/jsx';
import { Layout } from './Layout';
import { Sidebar } from './Sidebar';
import { loadTeamIdentitiesFromFilesystem } from '../../loaders/loadTeamIdentitiesFromFilesystem';

interface PageProps {
  title: string;
  heading: string;
  activePage: string;
  children: Child;
}

const teams = await loadTeamIdentitiesFromFilesystem();

export const Page: FC<PageProps> = ({ title, heading, activePage, children }) => {
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
