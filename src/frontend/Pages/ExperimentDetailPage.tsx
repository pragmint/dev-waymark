import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../../core/domain/teamTypes';
import type {
  Experiment,
  ExperimentActionItem,
  ExperimentDecisionRolesItem,
  ExperimentSuccessCriteriaItem,
} from '../../core/domain/experimentTypes';
function parseFlexibleDate(dateString?: string | null): Date | null {
  if (!dateString) return null;

  let date = new Date(dateString);
  if (!isNaN(date.getTime())) {
    return date;
  }

  const europeanMatch = dateString.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (europeanMatch) {
    const day = parseInt(europeanMatch[1], 10);
    const month = parseInt(europeanMatch[2], 10) - 1;
    const year = parseInt(europeanMatch[3], 10);
    date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function getStatusBadge(status: string): string {
  const statusColors: Record<string, { bg: string; text: string }> = {
    'in-progress': { bg: '#e8f5f0', text: '#228b6b' },
    blocked: { bg: '#f8d7da', text: '#721c24' },
    paused: { bg: '#fff3cd', text: '#856404' },
  };

  const colors = statusColors[status] || { bg: '#e0e0e0', text: '#666' };
  const label = status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());

  return `<span class="status-badge" style="background-color: ${colors.bg}; color: ${colors.text};">${label}</span>`;
}

function calculateEndDate(startDate?: string | null, duration?: string): string {
  if (!duration) return 'TBD';

  const start = parseFlexibleDate(startDate);
  if (!start) return 'TBD';

  const durationMatch = duration.match(/(\d+)\s*(week|month|day)/i);

  if (!durationMatch) return 'TBD';

  const amount = parseInt(durationMatch[1]);
  const unit = durationMatch[2].toLowerCase();

  const end = new Date(start);
  if (unit.startsWith('week')) {
    end.setDate(end.getDate() + amount * 7);
  } else if (unit.startsWith('month')) {
    end.setMonth(end.getMonth() + amount);
  } else if (unit.startsWith('day')) {
    end.setDate(end.getDate() + amount);
  }

  return end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export interface ExperimentDetailPageProps {
  teams: Team[];
  team: Team;
  experiment: Experiment;
  practiceName: string;
}

const SuccessCriteriaSection: FC<{ criteria?: ExperimentSuccessCriteriaItem[] }> = ({
  criteria,
}) => {
  if (!criteria || criteria.length === 0) {
    return <p class="empty-state">No success criteria defined yet.</p>;
  }

  return (
    <div class="success-criteria">
      {criteria.map(item => (
        <div class="criteria-item">
          <div class="criteria-header">
            <strong>Metric:</strong> {item.metric}
          </div>
          <div class="criteria-details">
            <div class="criteria-detail">
              <strong>Target:</strong> {item.target}
            </div>
            <div class="criteria-detail">
              <strong>Measurement Window:</strong> {item.measurement_window.replace(/_/g, ' ')}
            </div>
            {item.notes && (
              <div class="criteria-notes">
                <strong>Notes:</strong> {item.notes}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const ActionPlanSection: FC<{ actionPlan?: ExperimentActionItem[] }> = ({ actionPlan }) => {
  if (!actionPlan || actionPlan.length === 0) {
    return <p class="empty-state">No action plan defined yet.</p>;
  }

  return (
    <div class="action-plan">
      {actionPlan.map((item, index) => (
        <div class="action-item">
          <div class="action-item-header">
            <span class="action-item-number">{index + 1}</span>
            <span class="action-item-task">{item.title}</span>
            <span class="action-item-status">{item.status}</span>
          </div>
          {item['assigned-to'] && item['assigned-to'].length > 0 && (
            <div class="action-item-assignees">
              <strong>Assigned to:</strong> {item['assigned-to'].join(', ')}
            </div>
          )}
          {item.link && (
            <div class="action-item-link">
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                View task →
              </a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const DecisionRolesSection: FC<{ roles?: ExperimentDecisionRolesItem[] }> = ({ roles }) => {
  // Merge all objects in the roles array to get all role assignments
  const allRoles =
    roles && roles.length > 0
      ? roles.reduce(
          (acc, roleObj) => ({
            responsible: [...(acc.responsible || []), ...(roleObj.responsible || [])],
            accountable: [...(acc.accountable || []), ...(roleObj.accountable || [])],
            consulted: [...(acc.consulted || []), ...(roleObj.consulted || [])],
            informed: [...(acc.informed || []), ...(roleObj.informed || [])],
          }),
          {} as ExperimentDecisionRolesItem
        )
      : {};

  return (
    <div class="decision-roles">
      <div class="role-section">
        <h4>Responsible</h4>
        <p class="role-description">Actively working on the experiment</p>
        {allRoles.responsible && allRoles.responsible.length > 0 ? (
          <ul class="role-list">
            {allRoles.responsible.map(person => (
              <li>{person}</li>
            ))}
          </ul>
        ) : (
          <p class="role-empty">Not assigned</p>
        )}
      </div>

      <div class="role-section">
        <h4>Accountable</h4>
        <p class="role-description">Final authority on decisions</p>
        {allRoles.accountable && allRoles.accountable.length > 0 ? (
          <ul class="role-list">
            {allRoles.accountable.map(person => (
              <li>{person}</li>
            ))}
          </ul>
        ) : (
          <p class="role-empty">Not assigned</p>
        )}
      </div>

      <div class="role-section">
        <h4>Consulted</h4>
        <p class="role-description">Input sought before decisions are made</p>
        {allRoles.consulted && allRoles.consulted.length > 0 ? (
          <ul class="role-list">
            {allRoles.consulted.map(person => (
              <li>{person}</li>
            ))}
          </ul>
        ) : (
          <p class="role-empty">Not assigned</p>
        )}
      </div>

      <div class="role-section">
        <h4>Informed</h4>
        <p class="role-description">Kept informed of progress and decisions</p>
        {allRoles.informed && allRoles.informed.length > 0 ? (
          <ul class="role-list">
            {allRoles.informed.map(person => (
              <li>{person}</li>
            ))}
          </ul>
        ) : (
          <p class="role-empty">Not assigned</p>
        )}
      </div>
    </div>
  );
};

export const ExperimentDetailPage: FC<ExperimentDetailPageProps> = ({
  teams,
  team,
  experiment,
  practiceName,
}) => {
  const parsedStartDate = parseFlexibleDate(experiment.startDate);
  const startDate = parsedStartDate
    ? parsedStartDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD';
  const duration = experiment.expectedDurationInWeeks
    ? `${experiment.expectedDurationInWeeks} weeks`
    : undefined;
  const endDate = experiment.expectedDurationInWeeks
    ? calculateEndDate(experiment.startDate, duration)
    : 'Not specified';

  return (
    <Page
      title={`${practiceName} - ${team.name}`}
      heading={`Experiment: ${practiceName}`}
      activePage={team.id}
      teams={teams}
    >
      <div class="experiment-detail-container">
        <div class="experiment-detail-header">
          <div class="breadcrumbs">
            <a href="/">Home</a> /<a href={`/team/${team.id}/`}>{team.name}</a> / Experiment
          </div>
          <h1>{practiceName}</h1>
          <span dangerouslySetInnerHTML={{ __html: getStatusBadge(experiment.status) }} />
        </div>

        <div class="experiment-meta-bar">
          <div class="meta-item">
            <span class="meta-label">Team:</span>
            <a href={`/team/${team.id}/`} class="meta-value">
              {team.name}
            </a>
          </div>
          <div class="meta-item">
            <span class="meta-label">Practice:</span>
            <a
              href={`/catalog/practice/${experiment.intervention.practiceUnderTest}/`}
              class="meta-value"
            >
              {practiceName}
            </a>
          </div>
          <div class="meta-item">
            <span class="meta-label">Started:</span>
            <span class="meta-value">{startDate}</span>
          </div>
          {duration && (
            <div class="meta-item">
              <span class="meta-label">Duration:</span>
              <span class="meta-value">{duration}</span>
            </div>
          )}
          <div class="meta-item">
            <span class="meta-label">Expected End:</span>
            <span class="meta-value">{endDate}</span>
          </div>
        </div>

        <section class="experiment-section">
          <h2>Context</h2>
          <div class="context-content">
            <div class="context-item">
              <h3>Problem Statement</h3>
              <p>{experiment.context.problemStatement}</p>
            </div>
            <div class="context-item">
              <h3>Desired Outcome</h3>
              <p>{experiment.context.desiredOutcome}</p>
            </div>
          </div>
        </section>

        <section class="experiment-section">
          <h2>Hypothesis</h2>
          <div class="hypothesis-content">
            <div class="hypothesis-statement">
              <h3>Statement</h3>
              <p>{experiment.hypothesis.statement}</p>
            </div>
            {experiment.hypothesis.assumptions && experiment.hypothesis.assumptions.length > 0 && (
              <div class="hypothesis-item">
                <h3>Assumptions</h3>
                <ul>
                  {experiment.hypothesis.assumptions.map(assumption => (
                    <li>{assumption}</li>
                  ))}
                </ul>
              </div>
            )}
            {experiment.hypothesis.risks && experiment.hypothesis.risks.length > 0 && (
              <div class="hypothesis-item">
                <h3>Risks</h3>
                <ul>
                  {experiment.hypothesis.risks.map(risk => (
                    <li>{risk}</li>
                  ))}
                </ul>
              </div>
            )}
            {experiment.hypothesis.riskMitigations &&
              experiment.hypothesis.riskMitigations.length > 0 && (
                <div class="hypothesis-item">
                  <h3>Risk Mitigations</h3>
                  <ul>
                    {experiment.hypothesis.riskMitigations.map(mitigation => (
                      <li>{mitigation}</li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        </section>

        <section class="experiment-section">
          <h2>Intervention</h2>
          <div class="intervention-content">
            <div class="intervention-item">
              <h3>Practice Under Test</h3>
              <p>
                <a href={`/catalog/practice/${experiment.intervention.practiceUnderTest}/`}>
                  {practiceName}
                </a>
              </p>
            </div>
            <div class="intervention-item">
              <h3>Description</h3>
              <p>{experiment.intervention.description}</p>
            </div>

            <div class="intervention-subsection">
              <h3>Success Criteria</h3>
              <SuccessCriteriaSection criteria={experiment.successCriteria} />
            </div>

            <div class="intervention-subsection">
              <h3>Action Plan</h3>
              <ActionPlanSection actionPlan={experiment.actionPlan} />
            </div>
          </div>
        </section>

        <section class="experiment-section">
          <h2>Decision-Making Roles (RACI)</h2>
          <DecisionRolesSection roles={experiment.decisionRoles} />
        </section>

        <div class="experiment-actions">
          <a href={`/team/${team.id}/`} class="btn btn-secondary">
            ← Back to {team.name}
          </a>
          <a
            href={`/catalog/practice/${experiment.intervention.practiceUnderTest}/`}
            class="btn btn-primary"
          >
            View Practice Details
          </a>
        </div>
      </div>
    </Page>
  );
};
