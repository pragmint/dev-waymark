interface PageConfig {
  title: string;
  heading: string;
  activePage: string;
  content?: string;
}

interface Team {
  id: string;
  name: string;
}

export class PageRenderer {
  private layoutTemplate: string | null = null;
  private navTemplate: string | null = null;
  private teams: Team[] = [];

  async init(layoutTemplate?: string, navTemplate?: string) {
    if (layoutTemplate && navTemplate) {
      this.layoutTemplate = layoutTemplate;
      this.navTemplate = navTemplate;
    } else {
      const layoutFile = Bun.file("resources/private/html/partials/layout.html");
      const navFile = Bun.file("resources/private/html/partials/nav.html");

      this.layoutTemplate = await layoutFile.text();
      this.navTemplate = await navFile.text();
    }
  }

  setTeams(teams: Team[]) {
    this.teams = teams;
  }

  private generateTeamLinks(): string {
    if (this.teams.length === 0) {
      return '<li class="empty-state">No teams configured</li>';
    }

    return this.teams
      .map(team => {
        const pageId = team.id;
        return `<li><a href="/team/${team.id}/" data-page="${pageId}">${team.name}</a></li>`;
      })
      .join('\n      ');
  }

  render(config: PageConfig): string {
    if (!this.layoutTemplate || !this.navTemplate) {
      throw new Error("PageRenderer not initialized. Call init() first.");
    }

    // Generate dynamic team links
    const teamLinks = this.generateTeamLinks();
    let nav = this.navTemplate.replace('{{TEAM_LINKS}}', teamLinks);

    // Add active class to the appropriate nav link
    nav = nav.replace(
      `data-page="${config.activePage}"`,
      `data-page="${config.activePage}" class="active"`
    );

    // Replace placeholders in layout
    return this.layoutTemplate
      .replace("{{TITLE}}", config.title)
      .replace("{{HEADING}}", config.heading)
      .replace("{{NAV}}", nav)
      .replace("{{CONTENT}}", config.content || "");
  }
}

export const pageRenderer = new PageRenderer();
