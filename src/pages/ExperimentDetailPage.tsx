import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Team, ActiveExperiment, SupportingEvidence, ActionItem, DecisionRoles, ExpectedImpact } from '../core/data/teamTypes';
import { getStatusBadge, calculateEndDate } from '../core/rendering/htmlHelpers';

interface ExperimentDetailPageProps {
  teams: Team[];
  team: Team;
  experiment: ActiveExperiment;
  practiceName: string;
}

const SupportingEvidenceSection: FC<{ evidence?: SupportingEvidence }> = ({ evidence }) => {
  if (!evidence || (!evidence.metrics?.length && !evidence.anecdotes?.length)) {
    return <p class="empty-state">No supporting evidence documented yet.</p>;
  }

  return (
    <div class="supporting-evidence">
      {evidence.metrics && evidence.metrics.length > 0 && (
        <div class="evidence-subsection">
          <h4>Metrics</h4>
          <ul class="evidence-list">
            {evidence.metrics.map(metric => <li>{metric}</li>)}
          </ul>
        </div>
      )}
      {evidence.anecdotes && evidence.anecdotes.length > 0 && (
        <div class="evidence-subsection">
          <h4>Anecdotes</h4>
          <ul class="evidence-list">
            {evidence.anecdotes.map(anecdote => <li>{anecdote}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};

const ActionPlanSection: FC<{ actionPlan?: ActionItem[] }> = ({ actionPlan }) => {
  if (!actionPlan || actionPlan.length === 0) {
    return <p class="empty-state">No action plan defined yet.</p>;
  }

  return (
    <div class="action-plan">
      {actionPlan.map((item, index) => (
        <div class="action-item">
          <div class="action-item-header">
            <span class="action-item-number">{index + 1}</span>
            <span class="action-item-task">{item.task}</span>
          </div>
          <div class="action-item-assignees">
            <strong>Assigned to:</strong> {item.assignees.join(', ')}
          </div>
        </div>
      ))}
    </div>
  );
};

const DecisionRolesSection: FC<{ roles?: DecisionRoles }> = ({ roles }) => {
  if (!roles) {
    return <p class="empty-state">Decision roles not defined yet.</p>;
  }

  return (
    <div class="decision-roles">
      {roles.decisionMaker && roles.decisionMaker.length > 0 && (
        <div class="role-section">
          <h4>Decision Maker</h4>
          <p class="role-description">Final call on whether to adopt the practice</p>
          <ul class="role-list">
            {roles.decisionMaker.map(person => <li>{person}</li>)}
          </ul>
        </div>
      )}
      {roles.contributors && roles.contributors.length > 0 && (
        <div class="role-section">
          <h4>Contributors / Implementers</h4>
          <p class="role-description">Actively working on the experiment</p>
          <ul class="role-list">
            {roles.contributors.map(person => <li>{person}</li>)}
          </ul>
        </div>
      )}
      {roles.consulted && roles.consulted.length > 0 && (
        <div class="role-section">
          <h4>Consulted</h4>
          <p class="role-description">Input sought before decisions are made</p>
          <ul class="role-list">
            {roles.consulted.map(person => <li>{person}</li>)}
          </ul>
        </div>
      )}
      {roles.informed && roles.informed.length > 0 && (
        <div class="role-section">
          <h4>Informed</h4>
          <p class="role-description">Kept informed of progress and decisions</p>
          <ul class="role-list">
            {roles.informed.map(person => <li>{person}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};

const ExpectedImpactSection: FC<{ impact?: ExpectedImpact }> = ({ impact }) => {
  if (!impact || (!impact.metrics && !impact.anecdotes)) {
    return <p class="empty-state">Expected impact not documented yet.</p>;
  }

  return (
    <div class="expected-impact">
      {impact.metrics && (
        <div class="impact-subsection">
          <h4>Metrics Impact</h4>
          <p>{impact.metrics}</p>
        </div>
      )}
      {impact.anecdotes && (
        <div class="impact-subsection">
          <h4>Qualitative Impact</h4>
          <p>{impact.anecdotes}</p>
        </div>
      )}
    </div>
  );
};

export const ExperimentDetailPage: FC<ExperimentDetailPageProps> = ({ teams, team, experiment, practiceName }) => {
  const startDate = new Date(experiment.startDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const endDate = calculateEndDate(experiment.startDate, experiment.duration);

  return (
    <Page title={`${practiceName} - ${team.name}`} heading={`Experiment: ${practiceName}`} activePage={team.id} teams={teams}>
      <div class="experiment-detail-container">
        <div class="experiment-detail-header">
          <div class="breadcrumbs">
            <a href="/">Home</a> /
            <a href={`/team/${team.id}/`}>{team.name}</a> /
            Experiment
          </div>
          <h1>{practiceName}</h1>
          <span dangerouslySetInnerHTML={{ __html: getStatusBadge(experiment.status) }} />
        </div>

        <div class="experiment-meta-bar">
          <div class="meta-item">
            <span class="meta-label">Team:</span>
            <a href={`/team/${team.id}/`} class="meta-value">{team.name}</a>
          </div>
          <div class="meta-item">
            <span class="meta-label">Practice:</span>
            <a href={`/catalog/practice/${experiment.practiceId}/`} class="meta-value">{practiceName}</a>
          </div>
          <div class="meta-item">
            <span class="meta-label">Started:</span>
            <span class="meta-value">{startDate}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Duration:</span>
            <span class="meta-value">{experiment.duration || "Not specified"}</span>
          </div>
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
          <p class="section-intro">
            Tasks and assignments for executing this experiment.
          </p>
          <ActionPlanSection actionPlan={experiment.actionPlan} />
        </section>

        <section class="experiment-section">
          <h2>Decision-Making Roles</h2>
          <p class="section-intro">
            Who has what role in the decision to adopt or abandon this practice.
          </p>
          <DecisionRolesSection roles={experiment.decisionRoles} />
        </section>

        <section class="experiment-section">
          <h2>Expected Impact</h2>
          <p class="section-intro">
            What we expect to achieve if this experiment is successful.
          </p>
          <ExpectedImpactSection impact={experiment.expectedImpact} />
        </section>

        <div class="experiment-actions">
          <a href={`/team/${team.id}/`} class="btn btn-secondary">← Back to {team.name}</a>
          <a href={`/catalog/practice/${experiment.practiceId}/`} class="btn btn-primary">View Practice Details</a>
        </div>
      </div>
    </Page>
  );
};
