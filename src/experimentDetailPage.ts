import { getExperimentById, type ActiveExperiment, type ActionItem, type SupportingEvidence, type DecisionRoles, type ExpectedImpact } from "./teams";
import { loadPracticeById } from "./practiceDetailPage";

function getStatusBadge(status: string): string {
  const statusColors: Record<string, { bg: string; text: string }> = {
    "in-progress": { bg: "#e8f4f8", text: "#0066cc" },
    "blocked": { bg: "#f8d7da", text: "#721c24" },
    "paused": { bg: "#fff3cd", text: "#856404" },
  };

  const colors = statusColors[status] || { bg: "#e0e0e0", text: "#666" };
  const label = status.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase());

  return `<span class="status-badge" style="background-color: ${colors.bg}; color: ${colors.text};">${label}</span>`;
}

function calculateEndDate(startDate: string, duration?: string): string {
  if (!duration) return "TBD";

  const start = new Date(startDate);
  const durationMatch = duration.match(/(\d+)\s*(week|month|day)/i);

  if (!durationMatch) return "TBD";

  const amount = parseInt(durationMatch[1]);
  const unit = durationMatch[2].toLowerCase();

  const end = new Date(start);
  if (unit.startsWith("week")) {
    end.setDate(end.getDate() + amount * 7);
  } else if (unit.startsWith("month")) {
    end.setMonth(end.getMonth() + amount);
  } else if (unit.startsWith("day")) {
    end.setDate(end.getDate() + amount);
  }

  return end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderSupportingEvidence(evidence?: SupportingEvidence): string {
  if (!evidence || (!evidence.metrics?.length && !evidence.anecdotes?.length)) {
    return '<p class="empty-state">No supporting evidence documented yet.</p>';
  }

  const metricsHtml = evidence.metrics && evidence.metrics.length > 0
    ? `
      <div class="evidence-subsection">
        <h4>Metrics</h4>
        <ul class="evidence-list">
          ${evidence.metrics.map(metric => `<li>${metric}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  const anecdotesHtml = evidence.anecdotes && evidence.anecdotes.length > 0
    ? `
      <div class="evidence-subsection">
        <h4>Anecdotes</h4>
        <ul class="evidence-list">
          ${evidence.anecdotes.map(anecdote => `<li>${anecdote}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  return `
    <div class="supporting-evidence">
      ${metricsHtml}
      ${anecdotesHtml}
    </div>
  `;
}

function renderActionPlan(actionPlan?: ActionItem[]): string {
  if (!actionPlan || actionPlan.length === 0) {
    return '<p class="empty-state">No action plan defined yet.</p>';
  }

  const actionItems = actionPlan.map((item, index) => `
    <div class="action-item">
      <div class="action-item-header">
        <span class="action-item-number">${index + 1}</span>
        <span class="action-item-task">${item.task}</span>
      </div>
      <div class="action-item-assignees">
        <strong>Assigned to:</strong> ${item.assignees.join(", ")}
      </div>
    </div>
  `).join("");

  return `<div class="action-plan">${actionItems}</div>`;
}

function renderDecisionRoles(roles?: DecisionRoles): string {
  if (!roles) {
    return '<p class="empty-state">Decision roles not defined yet.</p>';
  }

  const sections = [];

  if (roles.decisionMaker && roles.decisionMaker.length > 0) {
    sections.push(`
      <div class="role-section">
        <h4>Decision Maker</h4>
        <p class="role-description">Final call on whether to adopt the practice</p>
        <ul class="role-list">
          ${roles.decisionMaker.map(person => `<li>${person}</li>`).join("")}
        </ul>
      </div>
    `);
  }

  if (roles.contributors && roles.contributors.length > 0) {
    sections.push(`
      <div class="role-section">
        <h4>Contributors / Implementers</h4>
        <p class="role-description">Actively working on the experiment</p>
        <ul class="role-list">
          ${roles.contributors.map(person => `<li>${person}</li>`).join("")}
        </ul>
      </div>
    `);
  }

  if (roles.consulted && roles.consulted.length > 0) {
    sections.push(`
      <div class="role-section">
        <h4>Consulted</h4>
        <p class="role-description">Input sought before decisions are made</p>
        <ul class="role-list">
          ${roles.consulted.map(person => `<li>${person}</li>`).join("")}
        </ul>
      </div>
    `);
  }

  if (roles.informed && roles.informed.length > 0) {
    sections.push(`
      <div class="role-section">
        <h4>Informed</h4>
        <p class="role-description">Kept informed of progress and decisions</p>
        <ul class="role-list">
          ${roles.informed.map(person => `<li>${person}</li>`).join("")}
        </ul>
      </div>
    `);
  }

  return `<div class="decision-roles">${sections.join("")}</div>`;
}

function renderExpectedImpact(impact?: ExpectedImpact): string {
  if (!impact || (!impact.metrics && !impact.anecdotes)) {
    return '<p class="empty-state">Expected impact not documented yet.</p>';
  }

  const metricsHtml = impact.metrics
    ? `
      <div class="impact-subsection">
        <h4>Metrics Impact</h4>
        <p>${impact.metrics}</p>
      </div>
    `
    : "";

  const anecdotesHtml = impact.anecdotes
    ? `
      <div class="impact-subsection">
        <h4>Qualitative Impact</h4>
        <p>${impact.anecdotes}</p>
      </div>
    `
    : "";

  return `
    <div class="expected-impact">
      ${metricsHtml}
      ${anecdotesHtml}
    </div>
  `;
}

export async function generateExperimentDetailPageContent(experimentId: string): Promise<string | null> {
  const result = getExperimentById(experimentId);

  if (!result) {
    return null;
  }

  const { team, experiment } = result;
  const practice = await loadPracticeById(experiment.practiceId);
  const practiceName = practice ? practice.title : experiment.practiceId;

  const startDate = new Date(experiment.startDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const endDate = calculateEndDate(experiment.startDate, experiment.duration);

  return `
    <link rel="stylesheet" href="/resources/public/experiment-detail.css">
    <link rel="stylesheet" href="/resources/public/team-detail.css">

    <div class="experiment-detail-container">
      <div class="experiment-detail-header">
        <div class="breadcrumbs">
          <a href="/">Home</a> /
          <a href="/team/${team.id}/">${team.name}</a> /
          Experiment
        </div>
        <h1>${practiceName}</h1>
        ${getStatusBadge(experiment.status)}
      </div>

      <div class="experiment-meta-bar">
        <div class="meta-item">
          <span class="meta-label">Team:</span>
          <a href="/team/${team.id}/" class="meta-value">${team.name}</a>
        </div>
        <div class="meta-item">
          <span class="meta-label">Practice:</span>
          <a href="/catalog/practice/${experiment.practiceId}/" class="meta-value">${practiceName}</a>
        </div>
        <div class="meta-item">
          <span class="meta-label">Started:</span>
          <span class="meta-value">${startDate}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Duration:</span>
          <span class="meta-value">${experiment.duration || "Not specified"}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Expected End:</span>
          <span class="meta-value">${endDate}</span>
        </div>
      </div>

      <section class="experiment-section">
        <h2>Hypothesis</h2>
        <div class="hypothesis-content">
          <p>${experiment.hypothesis}</p>
        </div>
      </section>

      <section class="experiment-section">
        <h2>Supporting Evidence</h2>
        <p class="section-intro">
          Current metrics and observations that motivated this experiment.
        </p>
        ${renderSupportingEvidence(experiment.supportingEvidence)}
      </section>

      <section class="experiment-section">
        <h2>Action Plan</h2>
        <p class="section-intro">
          Tasks and assignments for executing this experiment.
        </p>
        ${renderActionPlan(experiment.actionPlan)}
      </section>

      <section class="experiment-section">
        <h2>Decision-Making Roles</h2>
        <p class="section-intro">
          Who has what role in the decision to adopt or abandon this practice.
        </p>
        ${renderDecisionRoles(experiment.decisionRoles)}
      </section>

      <section class="experiment-section">
        <h2>Expected Impact</h2>
        <p class="section-intro">
          What we expect to achieve if this experiment is successful.
        </p>
        ${renderExpectedImpact(experiment.expectedImpact)}
      </section>

      <div class="experiment-actions">
        <a href="/team/${team.id}/" class="btn btn-secondary">← Back to ${team.name}</a>
        <a href="/catalog/practice/${experiment.practiceId}/" class="btn btn-primary">View Practice Details</a>
      </div>
    </div>
  `;
}
