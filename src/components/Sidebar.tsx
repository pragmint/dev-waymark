import type { FC } from 'hono/jsx';
import type { Team } from '../core/data/teamTypes';

interface SidebarProps {
  teams: Team[];
  activePage: string;
}

export const Sidebar: FC<SidebarProps> = ({ teams, activePage }) => {
  return (
    <nav class="sidebar">
      <h2>Step Engine</h2>

      <div class="nav-section">
        <ul class="nav-list">
          <li>
            <a href="/" data-page="overview" class={activePage === 'overview' ? 'active' : ''}>
              Overview
            </a>
          </li>
        </ul>
      </div>

      <div class="nav-section">
        <div class="nav-section-title">Teams</div>
        <ul class="nav-list nested">
          {teams.length === 0 ? (
            <li class="empty-state">No teams configured</li>
          ) : (
            teams.map(team => (
              <li>
                <a
                  href={`/team/${team.id}/`}
                  data-page={team.id}
                  class={activePage === team.id ? 'active' : ''}
                >
                  {team.name}
                </a>
              </li>
            ))
          )}
        </ul>
      </div>

      <div class="nav-section">
        <ul class="nav-list">
          <li>
            <a
              href="/insight/"
              data-page="insights"
              class={activePage === 'insights' ? 'active' : ''}
            >
              Insights
            </a>
          </li>
        </ul>
      </div>

      <div class="nav-section">
        <div class="nav-section-title">Catalogs</div>
        <ul class="nav-list nested">
          <li>
            <a
              href="/catalog/capability/"
              data-page="capabilities"
              class={activePage === 'capabilities' ? 'active' : ''}
            >
              Capabilities
            </a>
          </li>
          <li>
            <a
              href="/catalog/practice/"
              data-page="practices"
              class={activePage === 'practices' ? 'active' : ''}
            >
              Practices
            </a>
          </li>
        </ul>
      </div>

      <div class="data-updated">
        <div class="data-updated-label">Data last updated on:</div>
        <div class="data-updated-date">December 18, 2025</div>
      </div>
    </nav>
  );
};
