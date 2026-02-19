import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../../schemas/teamSchemas';
import type { Capability } from '../../schemas/capabilitySchemas';
import { CapabilityOverview } from '../components/capabilities/CapabilityOverview';
import { CapabilityHeader } from '../components/capabilities/CapabilityHeader';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { CapabilitySection } from '../components/capabilities/CapabilitySection';
import { CapabilityActionFooter } from '../components/capabilities/CapabilityActionFooter';

export interface CapabilityDetailPageProps {
  teams: Team[];
  capability: Capability;
  selectedTeam: string;
  markdownContent: string | null;
}

export const CapabilityDetailPage: FC<CapabilityDetailPageProps> = ({
  teams,
  capability,
  selectedTeam,
  markdownContent,
}) => {
  // Build team options for dropdown
  const teamOptions = [
    { value: 'all', label: 'Average' },
    ...teams.map(team => ({
      value: team.id,
      label: team.name,
    })),
  ];

  return (
    <Page title={capability.name} heading="" activePage="capabilities">
      <div class="capability-detail-container">
        <div class="capability-page-header">
          <h1>{capability.name}</h1>
          {teams.length > 1 && (
            <div class="capability-filter">
              <label for="team-filter" class="filter-label">
                View score for:
              </label>
              <select
                id="team-filter"
                class="team-filter-dropdown"
                onchange="window.location.href = window.location.pathname + (this.value === 'all' ? '' : '?team=' + this.value)"
              >
                {teamOptions.map(option => (
                  <option value={option.value} selected={option.value === selectedTeam}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <CapabilityHeader capability={capability} />

        <div class="capability-content">
          <CapabilityOverview capability={capability} />
          <CapabilitySection capability={capability} />
          <MarkdownRenderer content={markdownContent} />
        </div>

        <CapabilityActionFooter />
      </div>
    </Page>
  );
};
