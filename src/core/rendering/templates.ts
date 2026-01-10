// Pure template rendering functions - no classes, no state

export interface Templates {
  layout: string;
  nav: string;
}

export interface PageConfig {
  title: string;
  heading: string;
  activePage: string;
  content?: string;
}

export interface Team {
  id: string;
  name: string;
}

function generateTeamLinks(teams: Team[]): string {
  if (teams.length === 0) {
    return '<li class="empty-state">No teams configured</li>';
  }

  return teams
    .map(team => {
      const pageId = team.id;
      return `<li><a href="/team/${team.id}/" data-page="${pageId}">${team.name}</a></li>`;
    })
    .join('\n      ');
}

function addActiveClassToNav(nav: string, activePage: string): string {
  return nav.replace(
    `data-page="${activePage}"`,
    `data-page="${activePage}" class="active"`
  );
}

export function renderPage(templates: Templates, teams: Team[], config: PageConfig): string {
  // Generate dynamic team links
  const teamLinks = generateTeamLinks(teams);
  const navWithLinks = templates.nav.replace('{{TEAM_LINKS}}', teamLinks);

  // Add active class to the appropriate nav link
  const nav = addActiveClassToNav(navWithLinks, config.activePage);

  // Replace placeholders in layout
  return templates.layout
    .replace("{{TITLE}}", config.title)
    .replace("{{HEADING}}", config.heading)
    .replace("{{NAV}}", nav)
    .replace("{{CONTENT}}", config.content || "");
}
