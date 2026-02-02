import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team } from '../core/data/teamTypes';
import type {
  Experiment,
  ExperimentActionItem,
  ExperimentDecisionRolesItem,
} from '../core/data/experimentTypes';
import { getStatusBadge, calculateEndDate, parseFlexibleDate } from '../core/rendering/htmlHelpers';

interface ExperimentDetailPageProps {
  teams: Team[];
  team: Team;
  experiment: Experiment;
  practiceName: string;
}

const SupportingEvidenceSection: FC<{ evidence?: Experiment['supportingEvidence'] }> = ({
  evidence,
}) => {
  if (!evidence || evidence.length === 0) {
    return <p class="empty-state">No supporting evidence documented yet.</p>;
  }

  return (
    <div class="supporting-evidence">
      {evidence.map(evidenceItem => {
        return Object.entries(evidenceItem).map(([metricRef, details]) => (
          <div class="evidence-subsection">
            <h4>Metric: {metricRef}</h4>
            <ul class="evidence-list">
              {details.map(detail => (
                <li>
                  {detail['expected-impact'] && (
                    <div>
                      <strong>Expected Impact:</strong> {detail['expected-impact']}
                    </div>
                  )}
                  {detail['expected-duration'] && (
                    <div>
                      <strong>Expected Duration:</strong> {detail['expected-duration']}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ));
      })}
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
          <div class="action-item-assignees">
            <strong>Assigned to:</strong> {item['assigned-to']}
          </div>
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
  if (!roles || roles.length === 0) {
    return <p class="empty-state">Decision roles not defined yet.</p>;
  }

  // Flatten roles array (it's an array of role objects)
  const allRoles = roles[0];
  if (!allRoles) {
    return <p class="empty-state">Decision roles not defined yet.</p>;
  }

  return (
    <div class="decision-roles">
      {allRoles.responsible && allRoles.responsible.length > 0 && (
        <div class="role-section">
          <h4>Responsible</h4>
          <p class="role-description">Actively working on the experiment</p>
          <ul class="role-list">
            {allRoles.responsible.map(person => (
              <li>{person}</li>
            ))}
          </ul>
        </div>
      )}
      {allRoles.accountable && allRoles.accountable.length > 0 && (
        <div class="role-section">
          <h4>Accountable</h4>
          <p class="role-description">Final authority on decisions</p>
          <ul class="role-list">
            {allRoles.accountable.map(person => (
              <li>{person}</li>
            ))}
          </ul>
        </div>
      )}
      {allRoles.consulted && allRoles.consulted.length > 0 && (
        <div class="role-section">
          <h4>Consulted</h4>
          <p class="role-description">Input sought before decisions are made</p>
          <ul class="role-list">
            {allRoles.consulted.map(person => (
              <li>{person}</li>
            ))}
          </ul>
        </div>
      )}
      {allRoles.informed && allRoles.informed.length > 0 && (
        <div class="role-section">
          <h4>Informed</h4>
          <p class="role-description">Kept informed of progress and decisions</p>
          <ul class="role-list">
            {allRoles.informed.map(person => (
              <li>{person}</li>
            ))}
          </ul>
        </div>
      )}
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
    : 'Invalid Date';
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
            <a href={`/catalog/practice/${experiment.practice}/`} class="meta-value">
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
          <h2>Hypothesis</h2>
          <div class="hypothesis-content">
            <p>{experiment.hypothesis}</p>
          </div>
        </section>

        <section class="experiment-section">
          <h2>Supporting Evidence</h2>
          <p class="section-intro">
            Current metrics and observations that motivated this experiment.
          </p>
          <SupportingEvidenceSection evidence={experiment.supportingEvidence} />
        </section>

        <section class="experiment-section">
          <h2>Action Plan</h2>
          <p class="section-intro">Tasks and assignments for executing this experiment.</p>
          <ActionPlanSection actionPlan={experiment.actionPlan} />
        </section>

        <section class="experiment-section">
          <h2>Decision-Making Roles (RACI)</h2>
          <p class="section-intro">
            Who has what role in the decision to adopt or abandon this practice.
          </p>
          <DecisionRolesSection roles={experiment.decisionRoles} />
        </section>

        <div class="experiment-actions">
          <a href={`/team/${team.id}/`} class="btn btn-secondary">
            ← Back to {team.name}
          </a>
          <a href={`/catalog/practice/${experiment.practice}/`} class="btn btn-primary">
            View Practice Details
          </a>
        </div>
      </div>
    </Page>
  );
};
