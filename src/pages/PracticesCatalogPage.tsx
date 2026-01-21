import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../core/data/teamTypes';
import type { Practice } from '../shell/loaders/practiceLoader';

interface PracticesCatalogPageProps {
  teams: Team[];
  practices: Practice[];
}

export const PracticesCatalogPage: FC<PracticesCatalogPageProps> = ({ teams, practices }) => {
  return (
    <Page title="Practices" heading="Practices" activePage="practices" teams={teams}>
      <div class="practices-container">
        <div class="practices-intro">
          <p>
            Engineering practices are proven techniques and methodologies that help teams
            deliver better software. The practices below support the development of DORA
            capabilities and contribute to improved software delivery performance.
          </p>
        </div>

        <ul class="practices-list">
          {practices.map(practice => (
            <li class="practice-list-item">
              <a href={`/catalog/practice/${practice.id}/`}>{practice.title}</a>
            </li>
          ))}
        </ul>
      </div>
    </Page>
  );
};
